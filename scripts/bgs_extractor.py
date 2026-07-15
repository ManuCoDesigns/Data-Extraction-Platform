#!/usr/bin/env python3
"""
bgs_extractor.py — BGS Directory of Mines & Quarries →  Supplier Graph
==============================================================================

Implements SOP-DS-002 v1.1 exactly:
  1. Downloads or reads the BGS DMQ 2020 PDF
  2. Extracts all text with pdfplumber
  3. Uses Claude to parse the hierarchical structure (COMMODITY → MPA → SITE)
     and GROUP records by operator into supplier objects
  4. Applies all SOP rules: canonical_name, supply_chain_tier, industry_sector,
     products_offered deduplication, manufacturing_sites, fixed values
  5. Validates each supplier object against the pre-submission checklist (Section 11)
  6. Outputs: one JSON file per supplier + combined bgs_suppliers.json
  7. Optionally uploads to  API

Usage:
  python bgs_extractor.py --pdf BGS_DMQ_2020.pdf --output ./output --upload
  python bgs_extractor.py --pdf-url https://... --source-id <uuid> --upload
  python bgs_extractor.py --config config.json

Requirements:
  pip install anthropic requests pdfplumber python-dotenv

Config file (config.json):
  {
    "anthropic_api_key": "sk-ant-...",
    "_url": "https://-platform-production.up.railway.app",
    "_email": "admin@yourorg.com",
    "_password": "yourpassword",
    "source_id": "uuid-of-the-bgs-source",
    "pdf_path": "./BGS_DMQ_2020.pdf",
    "output_dir": "./bgs_output",
    "chunk_pages": 30
  }
"""

import os
import sys
import json
import re
import time
import argparse
from pathlib import Path
from datetime import datetime

try:
    import anthropic
except ImportError:
    sys.exit("Missing: pip install anthropic")

try:
    import pdfplumber
except ImportError:
    sys.exit("Missing: pip install pdfplumber")

try:
    import requests
except ImportError:
    sys.exit("Missing: pip install requests")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# ─── SOP-DS-002 constants ─────────────────────────────────────────────────────

BGS_SOURCE_URL = "https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/"

SECTOR_MAP = {
    "limestone": "construction minerals",
    "sand and gravel": "construction minerals",
    "sandstone": "construction minerals",
    "gritstone": "construction minerals",
    "granite": "construction minerals",
    "chalk": "construction minerals",
    "basalt": "construction minerals",
    "igneous": "construction minerals",
    "metamorphic": "construction minerals",
    "silica sand": "industrial minerals",
    "ball clay": "industrial minerals",
    "china clay": "industrial minerals",
    "kaolin": "industrial minerals",
    "fluorspar": "industrial minerals",
    "gypsum": "industrial minerals",
    "anhydrite": "industrial minerals",
    "potash": "industrial minerals",
    "salt": "industrial minerals",
    "brine": "industrial minerals",
    "clay": "industrial minerals",
    "shale": "industrial minerals",
    "barytes": "industrial minerals",
    "barite": "industrial minerals",
    "slate": "building stone",
    "building stone": "building stone",
    "cement": "cement and lime",
    "lime": "cement and lime",
    "limestone (for cement)": "cement and lime",
    "coal": "coal",
    "natural gas": "oil and gas",
    "crude oil": "oil and gas",
    "oil": "oil and gas",
    "gas": "oil and gas",
    "iron ore": "metals mining",
    "tin": "metals mining",
    "copper": "metals mining",
    "lead": "metals mining",
    "zinc": "metals mining",
    "gold": "metals mining",
    "recycled": "recycled aggregates",
    "peat": "peat",
    "wharf": "mineral handling",
    "handling": "mineral handling",
}

REGION_TO_COUNTRY = {
    "CSCT": "Scotland", "NSCT": "Scotland", "SSCT": "Scotland",
    "NIR": "Northern Ireland",
    "NWLS": "Wales", "SWLS": "Wales",
    "CHA": "Channel Islands",
    "IOM": "Isle of Man",
    "EEN": "England", "EMD": "England", "LON": "England",
    "NEA": "England", "NWE": "England", "SEA": "England",
    "SWE": "England", "WMD": "England", "YHU": "England",
}

FIXED_COMPLETENESS_FLAGS = {
    "review_score": "manual_only",
    "defect_rate_ppm": "manual_only",
    "on_time_delivery_rate": "manual_only",
    "pricing": "api_only",
    "inventory_levels": "api_only",
}

FIXED_SOURCES = [{
    "source_name": "BGS Directory of Mines and Quarries 2020, 11th Edition",
    "source_url": BGS_SOURCE_URL,
    "doi": None,
    "tier": "tier1",
}]


# ─── canonical_name transformation (Section 7.2) ─────────────────────────────

def make_canonical(company_name: str) -> str:
    """Apply SOP-DS-002 Section 7.2 canonical_name rules in order."""
    name = company_name.strip()
    name = name.lower()
    name = name.replace("&", "and")        # & → 'and' FIRST (v1.1 amendment)
    name = re.sub(r"\s+", "-", name)       # spaces → hyphens
    name = re.sub(r"[^a-z0-9\-]", "", name)  # remove all remaining punctuation
    name = re.sub(r"-+", "-", name)        # collapse multiple hyphens
    name = name.strip("-")
    return name


# ─── PDF extraction ───────────────────────────────────────────────────────────

def extract_pdf_text(pdf_path: str) -> str:
    """Extract all text from the BGS DMQ PDF using pdfplumber."""
    print(f"  Reading PDF: {pdf_path}")
    text_parts = []
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"  Total pages: {total}")
        for i, page in enumerate(pdf.pages):
            t = page.extract_text()
            if t:
                text_parts.append(t)
            if (i + 1) % 50 == 0:
                print(f"  Processed {i+1}/{total} pages…")
    text = "\n\n".join(text_parts)
    print(f"  Extracted {len(text):,} characters from {total} pages")
    return text


def download_pdf(url: str, dest: str) -> str:
    """Download the BGS PDF to a local file."""
    print(f"  Downloading PDF from {url}…")
    r = requests.get(url, timeout=120, stream=True)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(65536):
            f.write(chunk)
    size_mb = os.path.getsize(dest) / 1_048_576
    print(f"  Downloaded {size_mb:.1f} MB → {dest}")
    return dest


# ─── Claude extraction ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a data transformation specialist applying SOP-DS-002 v1.1 to extract structured supplier records from the BGS Directory of Mines & Quarries 2020 PDF.

CRITICAL RULES:
1. Create ONE supplier object per unique operating company. If Tarmac Ltd appears under LIMESTONE and SANDSTONE, it is ONE object.
2. Each mine/quarry/pit goes into manufacturing_sites[]. Each commodity+end_use goes into products_offered[].
3. canonical_name: lowercase → & to 'and' → spaces to hyphens → remove all punctuation except hyphens.
4. is_verified: ALWAYS false. supplier_id: ALWAYS null.
5. source_url in every products_offered entry: ALWAYS 'https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/'

SUPPLY CHAIN TIER:
- 1: quarry, mine, pit, peat workings, oil/gas/brine well
- 2: handling site, wharf, processing plant, recycling facility, spoil heap

INDUSTRY SECTOR (from primary commodity):
- Limestone, Sand&Gravel, Sandstone, Granite, Basalt, Igneous/Metamorphic → construction minerals
- Silica Sand, Ball Clay, China Clay, Fluorspar, Gypsum, Potash, Salt, Clay/Shale → industrial minerals  
- Building stone → building stone
- Cement/lime → cement and lime
- Coal → coal
- Oil/Gas → oil and gas
- Metals → metals mining
- Recycled aggregates → recycled aggregates
- Peat → peat
- Wharves/handling → mineral handling

PRODUCTS_OFFERED: One entry per site per commodity per end-use. Multiple end uses = multiple entries with same site, different grade.
product_id format: '{GridRef}_{CommodityCode}_{GradeSuffix}' e.g. 'SK089748_LS_AGG'

MANUFACTURING_SITES:
- location: '{Site Name} ({Grid Ref})'
- country: infer from BGS region code (CSCT/NSCT/SSCT=Scotland, NIR=Northern Ireland, NWLS/SWLS=Wales, CHA=Channel Islands, IOM=Isle of Man, all others=England)
- site_type: quarry|mine|pit|oil well|gas well|brine well|handling site|wharf|processing plant|spoil heap|recycling facility|peat workings
- raw: VERBATIM text from DMQ for this site (including MPA, end use, formation — do not paraphrase)

FIXED FIELDS ON EVERY OBJECT:
- data_completeness_flags: {"review_score":"manual_only","defect_rate_ppm":"manual_only","on_time_delivery_rate":"manual_only","pricing":"api_only","inventory_levels":"api_only"}
- sources: [{"source_name":"BGS Directory of Mines and Quarries 2020, 11th Edition","source_url":"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/","doi":null,"tier":"tier1"}]
- certification_references: []
- certifications_raw: null
- regulation_references: []
- website: null
- company_description: null
- typical_lead_time_days: null

OUTPUT: Return ONLY a valid JSON array of supplier objects. No preamble, no explanation, no markdown fences.
Each element is one supplier company with ALL its sites and products consolidated.

EXAMPLE OUTPUT:
[
  {
    "supplier_id": null,
    "duns_number": null,
    "company_name": "Cavendish Mill Fluorite Ltd",
    "canonical_name": "cavendish-mill-fluorite-ltd",
    "headquarters_location": "Hope Valley, United Kingdom",
    "website": null,
    "company_description": null,
    "industry_sector": "industrial minerals",
    "supply_chain_tier": 1,
    "typical_lead_time_days": null,
    "manufacturing_sites": [
      {
        "location": "Glebe Mine (SK222756)",
        "country": "England",
        "site_type": "mine",
        "raw": "Glebe Mine, Cavendish Mill Fluorite Ltd, Stoney Middleton, Derbyshire, S32 4TF. Grid: SK222756. MPA: Derbyshire County Council. End Use: Acid grade fluorspar, Ceramic grade fluorspar. Formation: Blue John Cavern Formation."
      }
    ],
    "certification_references": [],
    "certifications_raw": null,
    "regulation_references": [],
    "products_offered": [
      {
        "product_name": "Fluorspar",
        "grade": "Acid grade",
        "product_id": "SK222756_FLU_AG",
        "category": "FLUORSPAR",
        "source_url": "https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/",
        "datasheet_url": null,
        "cross_graph_material_id": null
      },
      {
        "product_name": "Fluorspar",
        "grade": "Ceramic grade",
        "product_id": "SK222756_FLU_CER",
        "category": "FLUORSPAR",
        "source_url": "https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/",
        "datasheet_url": null,
        "cross_graph_material_id": null
      }
    ],
    "is_verified": false,
    "data_completeness_flags": {"review_score":"manual_only","defect_rate_ppm":"manual_only","on_time_delivery_rate":"manual_only","pricing":"api_only","inventory_levels":"api_only"},
    "sources": [{"source_name":"BGS Directory of Mines and Quarries 2020, 11th Edition","source_url":"https://www.bgs.ac.uk/mineralsuk/download/directory-of-mines-and-quarries-2020/","doi":null,"tier":"tier1"}]
  }
]"""


def extract_chunk(text_chunk: str, api_key: str, chunk_num: int, total_chunks: int) -> list[dict]:
    """Extract supplier records from one chunk of PDF text using Claude."""
    client = anthropic.Anthropic(api_key=api_key)

    user_msg = f"""Extract all supplier records from this section of the BGS DMQ 2020 PDF (chunk {chunk_num}/{total_chunks}).

Remember: group by OPERATOR. Same company across multiple commodities = ONE supplier object.

PDF TEXT:
---
{text_chunk}
---

Return a JSON array of supplier objects for the companies found in THIS section only.
If you see a company that likely continues in other sections (e.g. Tarmac Ltd), still output what you have — duplicates will be merged in post-processing."""

    t0 = time.time()
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    elapsed = time.time() - t0

    raw = response.content[0].text if response.content else ""
    clean = raw.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*", "", clean)
        clean = re.sub(r"\s*```$", "", clean)

    try:
        records = json.loads(clean.strip())
        if not isinstance(records, list):
            print(f"  ⚠  Chunk {chunk_num}: expected array, got {type(records).__name__}")
            return []
        print(f"  ✓  Chunk {chunk_num}: {len(records)} suppliers in {elapsed:.1f}s")
        return records
    except json.JSONDecodeError as e:
        print(f"  ✗  Chunk {chunk_num}: JSON parse error — {e}")
        # Save raw for debugging
        debug_path = f"/tmp/bgs_chunk_{chunk_num}_raw.txt"
        with open(debug_path, "w") as f:
            f.write(raw)
        print(f"     Raw output saved to {debug_path}")
        return []


def merge_suppliers(all_records: list[dict]) -> dict[str, dict]:
    """
    Merge supplier objects that refer to the same company (SOP Rule 1).
    Uses canonical_name as the deduplication key.
    """
    merged: dict[str, dict] = {}

    for rec in all_records:
        key = rec.get("canonical_name", "").strip()
        if not key:
            key = make_canonical(rec.get("company_name", f"unknown_{len(merged)}"))

        if key not in merged:
            merged[key] = rec
        else:
            existing = merged[key]
            # Merge manufacturing_sites (dedupe by location)
            existing_locs = {s["location"] for s in existing.get("manufacturing_sites", [])}
            for site in rec.get("manufacturing_sites", []):
                if site["location"] not in existing_locs:
                    existing.setdefault("manufacturing_sites", []).append(site)
                    existing_locs.add(site["location"])
            # Merge products_offered (dedupe by product_id)
            existing_pids = {p["product_id"] for p in existing.get("products_offered", [])}
            for prod in rec.get("products_offered", []):
                if prod.get("product_id") not in existing_pids:
                    existing.setdefault("products_offered", []).append(prod)
                    existing_pids.add(prod.get("product_id", ""))

    return merged


def apply_fixed_fields(supplier: dict) -> dict:
    """Apply all SOP-DS-002 fixed field values to a supplier object."""
    supplier["is_verified"] = False
    supplier["supplier_id"] = None
    supplier["duns_number"] = None
    supplier.setdefault("website", None)
    supplier.setdefault("company_description", None)
    supplier.setdefault("typical_lead_time_days", None)
    supplier.setdefault("certification_references", [])
    supplier.setdefault("certifications_raw", None)
    supplier.setdefault("regulation_references", [])
    supplier["data_completeness_flags"] = FIXED_COMPLETENESS_FLAGS.copy()
    supplier["sources"] = FIXED_SOURCES.copy()

    # Ensure canonical_name is correct
    if supplier.get("company_name") and not supplier.get("canonical_name"):
        supplier["canonical_name"] = make_canonical(supplier["company_name"])

    # Ensure all products_offered have the correct source_url
    for prod in supplier.get("products_offered", []):
        prod["source_url"] = BGS_SOURCE_URL
        prod.setdefault("datasheet_url", None)
        prod.setdefault("cross_graph_material_id", None)

    return supplier


# ─── Pre-submission validation (Section 11) ───────────────────────────────────

def validate_supplier(supplier: dict) -> list[str]:
    """Run the Section 11 pre-submission checklist. Returns list of failures."""
    errors = []

    # Required fields
    if not supplier.get("company_name"):
        errors.append("FAIL: company_name is missing")
    if not supplier.get("products_offered"):
        errors.append("FAIL: products_offered is empty")
    if not supplier.get("sources"):
        errors.append("FAIL: sources array is missing")

    # Products_offered entries
    for i, prod in enumerate(supplier.get("products_offered", [])):
        if not prod.get("product_name"):
            errors.append(f"FAIL: products_offered[{i}].product_name is missing")
        if not prod.get("source_url"):
            errors.append(f"FAIL: products_offered[{i}].source_url is missing")
        if prod.get("source_url") and prod["source_url"] != BGS_SOURCE_URL:
            errors.append(f"WARN: products_offered[{i}].source_url is not the BGS DMQ URL")

    # Manufacturing sites
    for i, site in enumerate(supplier.get("manufacturing_sites", [])):
        if not site.get("location"):
            errors.append(f"FAIL: manufacturing_sites[{i}].location is missing")
        if not site.get("raw"):
            errors.append(f"FAIL: manufacturing_sites[{i}].raw (verbatim text) is missing")

    # Identity & classification
    canonical = supplier.get("canonical_name", "")
    if not canonical:
        errors.append("FAIL: canonical_name is missing")
    elif not re.match(r'^[a-z0-9\-]+$', canonical):
        errors.append(f"FAIL: canonical_name '{canonical}' contains invalid characters")

    if supplier.get("supply_chain_tier") not in (1, 2):
        errors.append(f"FAIL: supply_chain_tier must be 1 or 2, got {supplier.get('supply_chain_tier')}")

    valid_sectors = {"construction minerals","industrial minerals","building stone","cement and lime","coal","oil and gas","metals mining","recycled aggregates","peat","mineral handling"}
    if supplier.get("industry_sector") not in valid_sectors:
        errors.append(f"FAIL: industry_sector '{supplier.get('industry_sector')}' is not a valid value")

    # Fixed values
    if supplier.get("is_verified") is not False:
        errors.append("FAIL: is_verified must be false")

    # Dedupe check (product_ids)
    pids = [p.get("product_id") for p in supplier.get("products_offered", []) if p.get("product_id")]
    if len(pids) != len(set(pids)):
        errors.append("FAIL: duplicate product_id values found in products_offered")

    return errors


# ───  upload ────────────────────────────────────────────────────────────

class Client:
    def __init__(self, base_url: str, email: str, password: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Content-Type"] = "application/json"
        self._login(email, password)

    def _login(self, email: str, password: str):
        r = self.session.post(f"{self.base_url}/api/v1/auth/login",
                              json={"email": email, "password": password})
        r.raise_for_status()
        token = r.json()["access_token"]
        self.session.headers["Authorization"] = f"Bearer {token}"
        print(f"  ✓ Logged in to  as {email}")

    def upload_json(self, source_id: str, records: list[dict], filename: str) -> dict:
        import io
        content = json.dumps(records, ensure_ascii=False, indent=2).encode("utf-8")
        r = self.session.post(
            f"{self.base_url}/api/v1/sources/{source_id}/upload",
            files={"file": (filename, io.BytesIO(content), "application/json")},
            headers={k: v for k, v in self.session.headers.items() if k != "Content-Type"},
        )
        r.raise_for_status()
        return r.json()


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(args):
    config = {}
    if args.config and Path(args.config).exists():
        with open(args.config) as f:
            config = json.load(f)

    api_key     = args.api_key or config.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY")
    pdf_path    = args.pdf or config.get("pdf_path")
    pdf_url     = args.pdf_url or config.get("pdf_url")
    output_dir  = Path(args.output_dir or config.get("output_dir", "./bgs_output"))
    chunk_pages = int(args.chunk_pages or config.get("chunk_pages", 30))
    do_upload   = args.upload or config.get("upload", False)
    _url  = args._url or config.get("_url")
    email       = args.email or config.get("_email")
    password    = args.password or config.get("_password") or os.getenv("_PASSWORD")
    source_id   = args.source_id or config.get("source_id")

    if not api_key:
        sys.exit("Missing Anthropic API key — set ANTHROPIC_API_KEY or add to config.json")

    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # ── Get PDF ─────────────────────────────────────────────────────────────
    print(f"\n[1/5] Preparing PDF…")
    if not pdf_path:
        if pdf_url:
            pdf_path = str(output_dir / "BGS_DMQ_2020.pdf")
            download_pdf(pdf_url, pdf_path)
        else:
            pdf_path = str(output_dir / "BGS_DMQ_2020.pdf")
            print(f"  No PDF provided. Downloading from BGS…")
            download_pdf(BGS_SOURCE_URL, pdf_path)

    if not Path(pdf_path).exists():
        sys.exit(f"PDF not found: {pdf_path}")

    # ── Extract text ─────────────────────────────────────────────────────────
    print(f"\n[2/5] Extracting text from PDF…")
    full_text = extract_pdf_text(pdf_path)

    # Split into chunks for Claude (avoid context limits)
    # Split by page count approx by character count
    chars_per_chunk = chunk_pages * 2000  # ~2000 chars per page typical
    chunks = []
    start = 0
    while start < len(full_text):
        end = min(start + chars_per_chunk, len(full_text))
        # Try to split on a commodity heading boundary
        if end < len(full_text):
            # Look for a commodity heading within the last 2000 chars of this chunk
            search_start = max(start + chars_per_chunk - 2000, start)
            match = None
            for m in re.finditer(r'\n[A-Z][A-Z\s\(\)\/&\-]+\n', full_text[search_start:end + 1000]):
                match = m
            if match:
                end = search_start + match.start() + 1
        chunks.append(full_text[start:end])
        start = end

    print(f"  Split into {len(chunks)} chunks of ~{chunk_pages} pages each")

    # ── Extract with Claude ───────────────────────────────────────────────────
    print(f"\n[3/5] Extracting supplier records with Claude ({len(chunks)} chunks)…")
    all_raw_records = []
    for i, chunk in enumerate(chunks, 1):
        records = extract_chunk(chunk, api_key, i, len(chunks))
        all_raw_records.extend(records)
        time.sleep(1)  # Rate limit courtesy

    print(f"\n  Total raw records extracted: {len(all_raw_records)}")

    # ── Merge and apply fixed fields ─────────────────────────────────────────
    print(f"\n[4/5] Merging suppliers (deduplicating by canonical_name)…")
    merged = merge_suppliers(all_raw_records)

    final_suppliers = []
    for supplier in merged.values():
        supplier = apply_fixed_fields(supplier)
        final_suppliers.append(supplier)

    final_suppliers.sort(key=lambda s: s.get("company_name", "").lower())
    print(f"  Unique supplier objects: {len(final_suppliers)}")

    # ── Validate ─────────────────────────────────────────────────────────────
    print(f"\n  Running Section 11 pre-submission validation…")
    valid_count = 0
    invalid_count = 0
    all_errors = []
    for supplier in final_suppliers:
        errors = validate_supplier(supplier)
        if errors:
            invalid_count += 1
            all_errors.append({"company": supplier.get("company_name"), "errors": errors})
            for err in errors:
                print(f"  ⚠  {supplier.get('company_name')}: {err}")
        else:
            valid_count += 1

    print(f"\n  Valid:   {valid_count}")
    print(f"  Invalid: {invalid_count}")

    # ── Save output ───────────────────────────────────────────────────────────
    print(f"\n[5/5] Saving output…")

    # Combined file
    combined_path = output_dir / f"bgs_suppliers_{timestamp}.json"
    with open(combined_path, "w", encoding="utf-8") as f:
        json.dump({"suppliers": final_suppliers}, f, ensure_ascii=False, indent=2, default=str)
    print(f"  Combined → {combined_path}")

    # Individual files (one per supplier, named by canonical_name)
    individual_dir = output_dir / "individual"
    individual_dir.mkdir(exist_ok=True)
    for supplier in final_suppliers:
        fname = f"{supplier.get('canonical_name', 'unknown')}.json"
        with open(individual_dir / fname, "w", encoding="utf-8") as f:
            json.dump(supplier, f, ensure_ascii=False, indent=2, default=str)
    print(f"  Individual files → {individual_dir} ({len(final_suppliers)} files)")

    # Validation errors report
    if all_errors:
        err_path = output_dir / f"validation_errors_{timestamp}.json"
        with open(err_path, "w", encoding="utf-8") as f:
            json.dump(all_errors, f, ensure_ascii=False, indent=2)
        print(f"  Errors report → {err_path}")

    # ── Upload to  ──────────────────────────────────────────────────────
    if do_upload and _url and source_id:
        print(f"\n  Uploading to  source {source_id}…")
        client = Client(_url, email, password)
        result = client.upload_json(source_id, final_suppliers, combined_path.name)
        print(f"  ✓ Upload complete:")
        print(f"     Total rows:   {result.get('total_rows')}")
        print(f"     Valid rows:   {result.get('valid_rows')}")
        print(f"     Invalid rows: {result.get('invalid_rows')}")
        print(f"     Job ID:       {result.get('job_id')}")
        print(f"\n  Open  to review the extracted records.")
    elif do_upload:
        print("\n  ⚠  Upload requested but ---url / --source-id not set — skipping")

    print(f"\n✓ Done. Output in: {output_dir.resolve()}")
    print(f"  Suppliers extracted: {len(final_suppliers)}")
    print(f"  Valid for submission: {valid_count}/{len(final_suppliers)}\n")

    return final_suppliers


def main():
    parser = argparse.ArgumentParser(
        description="BGS Directory of Mines & Quarries →  Supplier Graph (SOP-DS-002 v1.1)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Use a local PDF and upload to :
  python bgs_extractor.py \\
    --pdf BGS_DMQ_2020.pdf \\
    --source-id ff9ca5e5-d621-424b-a69a-e337a63f54b4 \\
    ---url https://-platform-production.up.railway.app \\
    --email admin@yourorg.com --password yourpass \\
    --upload

  # Use a config file:
  python bgs_extractor.py --config config.json

  # Just extract to files (no upload):
  python bgs_extractor.py --pdf BGS_DMQ_2020.pdf --output ./output

Config file template:
{
  "anthropic_api_key": "sk-ant-...",
  "_url": "https://-platform-production.up.railway.app",
  "_email": "admin@yourorg.com",
  "_password": "yourpassword",
  "source_id": "uuid-of-the-source",
  "pdf_path": "./BGS_DMQ_2020.pdf",
  "output_dir": "./bgs_output",
  "chunk_pages": 30,
  "upload": true
}
""")
    parser.add_argument("--config",       metavar="FILE", help="JSON config file")
    parser.add_argument("--pdf",          metavar="FILE", help="Local BGS DMQ 2020 PDF path")
    parser.add_argument("--pdf-url",      metavar="URL",  help="URL to download the BGS DMQ PDF")
    parser.add_argument("--api-key",      metavar="KEY",  help="Anthropic API key")
    parser.add_argument("--output-dir",   metavar="DIR",  default="./bgs_output")
    parser.add_argument("--chunk-pages",  type=int, default=30, metavar="N",
                        help="Pages per Claude chunk (default: 30, reduce if hitting token limits)")
    parser.add_argument("--upload",       action="store_true", help="Upload to  after extraction")
    parser.add_argument("--source-id",    metavar="UUID", help=" source ID to upload to")
    parser.add_argument("---url",   metavar="URL",  help=" API base URL")
    parser.add_argument("--email",        metavar="EMAIL")
    parser.add_argument("--password",     metavar="PASS")

    args = parser.parse_args()
    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    run(args)


if __name__ == "__main__":
    main()
