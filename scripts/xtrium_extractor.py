#!/usr/bin/env python3
"""
xtrium_extractor.py — Xtrium DataOps Extraction Script
=======================================================

Scrapes a company website and extracts structured records using the
BGS Supplier Graph Schema as the base, with source-specific extras
added on top for fields that don't fit the BGS structure.

The BGS base fields are always populated first:
  company_name, canonical_name, headquarters_location, website,
  company_description, industry_sector, supply_chain_tier, is_verified,
  manufacturing_sites[], products_offered[], sources[]

Any data that doesn't fit BGS goes in extras fields (marked extras:true
in the schema definition so the JSON viewer shows them distinctly).

Critical Materials extras (from company websites):
  ticker_symbol, stock_exchange, primary_commodities, by_product_commodities,
  annual_production[], jv_stakes[], processing_capabilities[], certifications[],
  data_transparency_level, sustainability_report_url, annual_report_url,
  investor_relations_url

Usage:
  python xtrium_extractor.py --url https://www.albemarle.com --source-id <uuid> --upload
  python xtrium_extractor.py --config config.json

Requirements: pip install anthropic requests beautifulsoup4

Config file (config.json):
{
  "anthropic_api_key": "sk-ant-...",
  "xtrium_url": "https://xtrium-platform-production.up.railway.app",
  "xtrium_email": "admin@yourorg.com",
  "xtrium_password": "yourpassword",
  "source_id": "uuid-of-the-source",
  "output_dir": "./output",
  "upload": true
}
"""
import os, sys, json, re, time, argparse, io
from pathlib import Path
from datetime import datetime

try:
    import requests
    from bs4 import BeautifulSoup
    import anthropic
except ImportError:
    sys.exit("pip install anthropic requests beautifulsoup4")

try:
    from dotenv import load_dotenv; load_dotenv()
except ImportError:
    pass

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Pages to probe on each company site
PROBE_PATHS = [
    "", "/about", "/who-we-are", "/operations", "/our-operations",
    "/what-we-do", "/products", "/locations", "/global-locations",
    "/mining-operations", "/sustainability", "/investors",
    "/investor-relations", "/about-us", "/company",
]


def make_canonical(name: str) -> str:
    n = str(name).lower().strip()
    n = n.replace("&", "and")
    n = re.sub(r"\s+", "-", n)
    n = re.sub(r"[^a-z0-9\-]", "", n)
    return re.sub(r"-+", "-", n).strip("-")


def fetch_page(url: str, timeout=20) -> str:
    try:
        r = requests.get(url, headers=BROWSER_HEADERS, timeout=timeout, allow_redirects=True)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup(["script","style","nav","footer","noscript","svg","aside","iframe"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r" {2,}", " ", text).strip()
        return text[:10000]
    except Exception:
        return ""


def crawl_site(base_url: str, max_pages=5) -> str:
    base = base_url.rstrip("/")
    print(f"  Crawling {base}…")
    pages = []
    fetched = 0

    home = fetch_page(base)
    if home:
        pages.append(f"=== HOME ({base}) ===\n{home}")
        fetched += 1

    priority = ["/operations", "/our-operations", "/about", "/what-we-do",
                "/products", "/locations", "/who-we-are", "/sustainability"]
    for path in priority:
        if fetched >= max_pages:
            break
        t = fetch_page(base + path)
        if t and len(t) > 300:
            pages.append(f"=== {path} ===\n{t}")
            fetched += 1
            time.sleep(0.3)

    combined = "\n\n".join(pages)
    print(f"  Fetched {fetched} pages — {len(combined):,} chars")
    return combined


# ─── Claude extraction prompt ────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a critical materials supply chain analyst extracting supplier intelligence from company websites.

USE THE BGS SUPPLIER GRAPH SCHEMA AS THE BASE STRUCTURE — always populate these fields first:

BGS BASE FIELDS:
- supplier_id: null (always)
- duns_number: null (always)
- company_name: Full legal name from website header/About page
- canonical_name: lowercase, & → 'and', spaces → hyphens, remove punctuation
- headquarters_location: 'City, Country' from Contact/About page
- website: company URL
- company_description: company's own About text (concise)
- industry_sector: ONE OF: "metals mining" | "industrial minerals" | "construction minerals" | "cement and lime" | "coal" | "oil and gas" | "recycled aggregates" | "peat" | "mineral handling"
  Map: Lithium/Cobalt/Nickel/Copper/Zinc/REE/Gold/Iron ore → metals mining
       Graphite/Silica/Ball Clay/China Clay/Fluorspar → industrial minerals
       Bauxite/Construction aggregates → construction minerals
       Coal → coal
- supply_chain_tier: 1=mine/primary extractor, 2=refiner/smelter/processor/recycler, 3=trader (if both, use 1)
- typical_lead_time_days: null (always)
- is_verified: false (always)
- manufacturing_sites: ONE entry per named mine/plant/refinery. Each:
  {location: "Site Name, Country/Region", country: "...", site_type: "mine|quarry|refinery|smelter|processing plant|recycling facility", raw: "verbatim text from website about this site"}
- products_offered: ONE per distinct product grade. Separate battery-grade vs technical-grade:
  {product_name:"Lithium Hydroxide", grade:"Battery-grade", product_id:"canonical_name_LiOH_BG", category:"Lithium", source_url:"company URL", datasheet_url:null, cross_graph_material_id:null}
- certification_references: []
- certifications_raw: null
- regulation_references: []
- data_completeness_flags: {"review_score":"manual_only","defect_rate_ppm":"manual_only","on_time_delivery_rate":"manual_only","pricing":"api_only","inventory_levels":"api_only"}
- sources: [{"source_name":"Company Website","source_url":"website URL","doi":null,"tier":"tier2"}]

EXTRAS FIELDS (add ONLY if the data exists on the website — these go beyond BGS):
- ticker_symbol: stock ticker (e.g. "ALB", "GLEN", "LYC")
- stock_exchange: exchange (e.g. "NYSE", "LSE", "ASX")
- primary_commodities: array e.g. ["Lithium","Bromine"]
- by_product_commodities: array e.g. ["Gold","Silver","Sulfuric acid"]
- annual_production: array of {commodity, volume, unit, year, notes} from production reports
  e.g. {"commodity":"Cobalt","volume":"36,100","unit":"tonnes","year":"2025","notes":"own sourced"}
- jv_stakes: array of {site_name, ownership_pct, jv_partners:[], country, commodity}
  e.g. {"site_name":"Collahuasi","ownership_pct":44,"jv_partners":["Anglo American"],"country":"Chile","commodity":"Copper"}
- processing_capabilities: array e.g. ["brine extraction","solar evaporation","direct lithium extraction"]
- certifications: array e.g. ["Copper Mark","IRMA","ISO 14001","LME responsible sourcing"]
- sustainability_report_url: URL if linked on website
- annual_report_url: URL if linked on website
- investor_relations_url: URL if linked on website

OUTPUT: Return ONLY a valid JSON object. No preamble, no markdown fences, no explanation."""

USER_TEMPLATE = """Company website: {url}

Website content:
---
{content}
---

Extract the supplier record for this company using BGS Supplier Graph Schema as the base, 
plus any extras fields you can find on the website."""


def extract_with_claude(content: str, url: str, api_key: str) -> dict:
    client = anthropic.Anthropic(api_key=api_key)
    print(f"  Calling Claude…")
    t0 = time.time()
    r = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role":"user","content":USER_TEMPLATE.format(url=url, content=content[:55000])}]
    )
    elapsed = time.time() - t0
    raw = r.content[0].text if r.content else ""
    clean = raw.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*","",clean)
        clean = re.sub(r"\s*```$","",clean)
    record = json.loads(clean.strip())

    # Ensure fixed values
    record["is_verified"] = False
    record["supplier_id"] = None
    record["duns_number"] = None
    if not record.get("data_completeness_flags"):
        record["data_completeness_flags"] = {"review_score":"manual_only","defect_rate_ppm":"manual_only","on_time_delivery_rate":"manual_only","pricing":"api_only","inventory_levels":"api_only"}
    if not record.get("sources"):
        record["sources"] = [{"source_name":"Company Website","source_url":url,"doi":None,"tier":"tier2"}]
    if not record.get("certification_references"):
        record["certification_references"] = []
    if not record.get("regulation_references"):
        record["regulation_references"] = []

    sites = len(record.get("manufacturing_sites",[]))
    prods = len(record.get("products_offered",[]))
    extras = [k for k in ["ticker_symbol","annual_production","jv_stakes","primary_commodities"] if record.get(k)]
    print(f"  ✓ {elapsed:.1f}s — {sites} sites, {prods} products, extras: {extras}")
    return record


# ─── Xtrium API ───────────────────────────────────────────────────────────────

class XtriumAPI:
    def __init__(self, base, email, pw):
        self.b = base.rstrip("/")
        self.s = requests.Session()
        self.s.headers["Content-Type"] = "application/json"
        r = self.s.post(f"{self.b}/api/v1/auth/login",json={"email":email,"password":pw})
        r.raise_for_status()
        self.s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        print(f"✓ Authenticated as {email}")

    def upload(self, source_id, record, fname):
        content = json.dumps([record], ensure_ascii=False, indent=2).encode()
        r = self.s.post(f"{self.b}/api/v1/sources/{source_id}/upload",
            files={"file":(fname, io.BytesIO(content), "application/json")},
            headers={k:v for k,v in self.s.headers.items() if k != "Content-Type"})
        r.raise_for_status(); return r.json()


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(args):
    config = {}
    if args.config and Path(args.config).exists():
        with open(args.config) as f: config = json.load(f)

    api_key   = args.api_key or config.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY")
    url       = args.url or config.get("url")
    source_id = args.source_id or config.get("source_id")
    out_dir   = Path(args.output_dir or config.get("output_dir","./xtrium_output"))
    do_upload = args.upload or config.get("upload", False)
    xtrium_url = args.xtrium_url or config.get("xtrium_url","")
    email     = args.email or config.get("xtrium_email","")
    password  = args.password or config.get("xtrium_password","") or os.getenv("XTRIUM_PASSWORD","")

    if not api_key: sys.exit("Missing ANTHROPIC_API_KEY")
    if not url: sys.exit("Missing --url")

    out_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    print(f"\n[1/3] Crawling {url}…")
    content = crawl_site(url)
    if not content: sys.exit("No content fetched — check the URL")

    print(f"\n[2/3] Extracting (BGS base + extras)…")
    record = extract_with_claude(content, url, api_key)

    cn = record.get("canonical_name") or make_canonical(record.get("company_name","record"))
    fname = f"{cn}_{timestamp}.json"
    out_file = out_dir / fname
    with open(out_file,"w",encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2, default=str)

    print(f"\n  Saved → {out_file}")
    print(f"  BGS fields: company_name={record.get('company_name')}, sector={record.get('industry_sector')}, tier={record.get('supply_chain_tier')}")
    print(f"  Sites: {len(record.get('manufacturing_sites',[]))}  Products: {len(record.get('products_offered',[]))}")
    if record.get("ticker_symbol"): print(f"  Ticker: {record.get('ticker_symbol')} ({record.get('stock_exchange')})")
    if record.get("annual_production"): print(f"  Production entries: {len(record['annual_production'])}")
    if record.get("jv_stakes"): print(f"  JV stakes: {len(record['jv_stakes'])}")

    if do_upload and xtrium_url and source_id:
        print(f"\n[3/3] Uploading to Xtrium…")
        api = XtriumAPI(xtrium_url, email, password)
        result = api.upload(source_id, record, fname)
        print(f"  ✓ {result.get('valid_rows')}/{result.get('total_rows')} valid")
    else:
        print("\n[3/3] Upload skipped (add --upload --source-id <uuid> to upload)")

    print(f"\n✓ Done. {out_file}\n")
    return record


def main():
    p = argparse.ArgumentParser(
        description="Extract company website → BGS Supplier Graph Schema + extras",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract Albemarle and upload to an Xtrium source:
  python xtrium_extractor.py \\
    --url https://www.albemarle.com \\
    --source-id your-source-uuid \\
    --xtrium-url https://xtrium-platform-production.up.railway.app \\
    --email admin@yourorg.com --password yourpass \\
    --upload

  # Extract to file only (no upload):
  python xtrium_extractor.py --url https://www.glencore.com --output ./output

  # Use a config file:
  python xtrium_extractor.py --config config.json

Output format:
  BGS base fields (18): company_name, manufacturing_sites, products_offered, etc.
  Extras fields (if found on website): ticker_symbol, annual_production,
  jv_stakes, primary_commodities, by_product_commodities, certifications, etc.
""")
    p.add_argument("--config", metavar="FILE")
    p.add_argument("--url", metavar="URL", help="Company website to extract")
    p.add_argument("--source-id", metavar="UUID")
    p.add_argument("--xtrium-url", metavar="URL", default="https://xtrium-platform-production.up.railway.app")
    p.add_argument("--email"); p.add_argument("--password"); p.add_argument("--api-key")
    p.add_argument("--output-dir", default="./xtrium_output")
    p.add_argument("--upload", action="store_true")
    args = p.parse_args()
    if len(sys.argv) == 1: p.print_help(); sys.exit(0)
    run(args)

if __name__ == "__main__": main()
