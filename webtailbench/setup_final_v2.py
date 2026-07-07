#!/usr/bin/env python3
"""
WebTailBench → Xtrium  —  Final Setup v2
- Cleans up old WebTailBench projects
- Creates project, schema, 11 sources
- Uploads pre-filled records (all Excel data preserved)
- Records flatten urls_visited/data_extracted to strings for schema compatibility
"""
import json, time, sys
from pathlib import Path

try: import requests
except ImportError: print("pip install requests"); sys.exit(1)

BASE = "https://xtrium-platform-production.up.railway.app/api/v1"
HERE = Path(__file__).parent

EMAIL = input("Xtrium admin email:    ").strip()
PASS  = input("Xtrium admin password: ").strip()

CAT_INFO = {
    "compositional_tasks_v2": ("Compositional Tasks",    "Multi-step: find, verify, cross-reference across multiple websites. 47 tasks are annotated with gold answers."),
    "things_to_do":           ("Things To Do",           "Discover activities, events, and local attractions using online platforms."),
    "price_comparison":       ("Price Comparison",       "Compare prices across retailers, services, or products using live websites."),
    "ticketing":              ("Ticketing",              "Search and retrieve event ticket details from ticketing platforms."),
    "shopping_head":          ("Shopping — Head",        "Find and retrieve product details from popular e-commerce platforms."),
    "flights":                ("Flights",                "Search and retrieve flight information using airline or booking websites."),
    "hotels_head":            ("Hotels — Head",          "Search and retrieve hotel details, pricing, and availability."),
    "restaurants_tail":       ("Restaurants — Tail",     "Find restaurant details, menus, reviews, and reservations online."),
    "shopping_lists_tail":    ("Shopping Lists — Tail",  "Compile and price multi-item shopping lists across online stores."),
    "jobs":                   ("Jobs",                   "Search job listings and retrieve role details from job platforms."),
    "realestate_complex":     ("Real Estate — Complex",  "Research property listings, prices, and real estate data online."),
}

# Schema — all fields as strings for max compatibility
SCHEMA_DEF = {
    "extraction_instructions": """EXTRACTOR WORKFLOW
━━━━━━━━━━━━━━━━━━
1. Read task_summary in this record — it is the task to complete
2. Read criteria — it tells you exactly how your answer will be scored
3. Visit the required websites and collect the data
4. Fill Section B fields: extracted_answer, urls_visited, primary_url, data_extracted, extraction_notes
5. Set extraction_complete = "true"
6. Upload the completed JSON file to Xtrium

DO NOT change Section A fields (task_id through video_link) — they are read-only reference data.
Leave Section C fields (score_achieved, score_breakdown, reviewer_notes) blank for the reviewer.

If reference_answer is provided, use it for calibration after completing the task yourself first.""",
    "fields": [
        # A — Reference (pre-filled)
        {"name":"task_id","type":"string","required":True,"description":"[READ-ONLY] Task ID from WebTailBench dataset"},
        {"name":"benchmark","type":"string","required":True,"description":"[READ-ONLY] Benchmark category"},
        {"name":"task_summary","type":"string","required":True,"description":"[READ-ONLY] The complete task to perform"},
        {"name":"criteria","type":"string","required":True,"description":"[READ-ONLY] Full scoring rubric with point values"},
        {"name":"num_criteria","type":"string","required":True,"description":"[READ-ONLY] Number of scoring criteria"},
        {"name":"total_max_points","type":"string","required":True,"description":"[READ-ONLY] Maximum score for this task"},
        {"name":"is_annotated","type":"string","required":True,"description":"[READ-ONLY] true if task is marked annotated"},
        {"name":"has_reference_answer","type":"string","required":True,"description":"[READ-ONLY] true if gold answer exists"},
        {"name":"reference_answer","type":"string","required":False,"description":"[READ-ONLY] Gold answer for calibration (null if not available)"},
        {"name":"video_link","type":"string","required":False,"description":"[READ-ONLY] Video evidence link from dataset"},
        # B — Extractor fills
        {"name":"extracted_answer","type":"string","required":False,"description":"EXTRACTOR: Your complete answer — exact values, names, figures found on site"},
        {"name":"urls_visited","type":"string","required":False,"description":"EXTRACTOR: All URLs visited, comma-separated"},
        {"name":"primary_url","type":"string","required":False,"description":"EXTRACTOR: The main website or tool used"},
        {"name":"data_extracted","type":"string","required":False,"description":"EXTRACTOR: Key data points found (as JSON string or plain text)"},
        {"name":"extraction_notes","type":"string","required":False,"description":"EXTRACTOR: Blockers, CAPTCHAs, paywalls, or caveats"},
        {"name":"extraction_complete","type":"string","required":False,"description":"EXTRACTOR: Set to 'true' when done"},
        # C — Reviewer fills
        {"name":"score_achieved","type":"string","required":False,"description":"REVIEWER: Points awarded (0 to total_max_points)"},
        {"name":"score_breakdown","type":"string","required":False,"description":"REVIEWER: Per-criterion breakdown e.g. C1: 3/4 — found correct URL"},
        {"name":"reviewer_notes","type":"string","required":False,"description":"REVIEWER: Overall evaluation and feedback"},
    ]
}

def prep_record(r):
    """Flatten all fields to strings for schema compatibility."""
    return {
        "task_id":              str(r["task_id"]),
        "benchmark":            r["benchmark"],
        "task_summary":         r["task_summary"] or "",
        "criteria":             r["criteria"] or "",
        "num_criteria":         str(r["num_criteria"]),
        "total_max_points":     str(r["total_max_points"]),
        "is_annotated":         str(r["is_annotated"]).lower(),
        "has_reference_answer": str(r["has_reference_answer"]).lower(),
        "reference_answer":     r["reference_answer"] or "",
        "video_link":           r["video_link"] or "",
        "extracted_answer":     "",
        "urls_visited":         "",
        "primary_url":          "",
        "data_extracted":       "",
        "extraction_notes":     "",
        "extraction_complete":  "false",
        "score_achieved":       "",
        "score_breakdown":      "",
        "reviewer_notes":       "",
    }

def ok(r, what):
    if r.status_code not in (200,201):
        print(f"  ✗ {what}: {r.status_code} — {r.text[:200]}")
        return False
    return True

def step(n, msg): print(f"\n{'━'*60}\n{n}. {msg}")

step(1,"Authenticating…")
r = requests.post(f"{BASE}/auth/login", json={"email":EMAIL,"password":PASS})
if not ok(r,"login"): sys.exit(1)
H = {"Authorization": f"Bearer {r.json()['access_token']}"}
print("  ✓ Logged in")

step(2,"Cleaning up old WebTailBench projects…")
r = requests.get(f"{BASE}/projects", headers=H)
if ok(r,"list"):
    data = r.json()
    items = data.get("items", data) if isinstance(data,dict) else data
    for p in [x for x in items if "WebTailBench" in x.get("name","")]:
        rd = requests.delete(f"{BASE}/projects/{p['id']}", headers=H)
        print(f"  {'✓' if rd.status_code in (200,204) else '✗'} deleted: {p['name']}")

step(3,"Creating project…")
r = requests.post(f"{BASE}/projects", headers=H, json={
    "name":"WebTailBench",
    "description":"WebTailBench v2 — 609 web browsing benchmark tasks across 11 categories.\n\nWorkflow:\n  Extractor: open record → read task_summary + criteria → visit websites → fill extracted_answer + urls_visited → upload JSON\n  Reviewer: read answer → score against criteria → fill score_achieved + score_breakdown",
    "submission_destinations":["json_download"],
})
if not ok(r,"project"): sys.exit(1)
project_id = r.json()["id"]
print(f"  ✓ {project_id}")

step(4,"Creating schema…")
r = requests.post(f"{BASE}/schemas/{project_id}", headers=H, json={
    "name":"WebTailBench Task Schema v1.0",
    "definition":SCHEMA_DEF,
})
if not ok(r,"schema"): sys.exit(1)
schema_id = r.json()["id"]
print(f"  ✓ {schema_id}")

step(5,"Creating 11 sources + uploading records…")
all_records = json.loads((HERE/"all_records.json").read_text())
records_by_cat = {}
for rec in all_records:
    records_by_cat.setdefault(rec["benchmark"],[]).append(rec)

total = 0
for cat_key,(cat_name,cat_desc) in CAT_INFO.items():
    recs = records_by_cat.get(cat_key,[])
    if not recs: print(f"  ⚠ No records for {cat_key}"); continue

    ann = sum(1 for r in recs if r["is_annotated"])
    has_ref = sum(1 for r in recs if r["has_reference_answer"])

    r = requests.post(f"{BASE}/sources", headers=H,
        params={"project_id":project_id},
        json={"schema_id":schema_id,"name":cat_name,
              "description":f"{cat_desc}\n\nTasks: {len(recs)} | Annotated: {ann} | With reference answers: {has_ref}\n\nWorkflow: Open a record → read task_summary and criteria → visit the relevant websites → fill extracted_answer and upload JSON",
              "website_url":"https://webtailbench.github.io"})
    if not ok(r,f"source {cat_name}"): continue
    source_id = r.json()["id"]

    prepped = [prep_record(rec) for rec in recs]
    up = requests.post(f"{BASE}/sources/{source_id}/upload", headers=H,
        files={"file":(f"{cat_key}.json", json.dumps(prepped).encode(),"application/json")})
    if ok(up,f"upload {cat_name}"):
        total += len(prepped)
        print(f"  ✓ {cat_name:<30} {len(prepped):>3} records  {f'({ann} annotated, {has_ref} with answers)' if ann or has_ref else ''}")
    time.sleep(0.3)

print(f"\n{'━'*60}\n✓ Done! {total} records uploaded\n")
print(f"  Open: https://xtrium-platform.vercel.app")
