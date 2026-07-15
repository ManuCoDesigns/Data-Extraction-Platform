#!/usr/bin/env python3
"""
WebTailBench →  setup script v2
Each task = 1 source (task details in source description)
Schema = only the answer/scoring fields the team fills in
Extractor reads the task from the source, does the work, creates a record with their answer
"""
import json, time, sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Run: pip install requests"); sys.exit(1)

BASE   = "https://-platform-production.up.railway.app/api/v1"
EMAIL  = input(" admin email:    ").strip()
PASS   = input(" admin password: ").strip()

HERE = Path(__file__).parent

def ok(r, what):
    if r.status_code not in (200, 201):
        print(f"  ✗ {what}: {r.status_code} — {r.text[:200]}")
        return False
    return True

def step(msg): print(f"\n{'─'*60}\n{msg}")

# ── 1. Login ──────────────────────────────────────────────────────────────────
step("1. Authenticating…")
r = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PASS})
if not ok(r, "login"): sys.exit(1)
H = {"Authorization": f"Bearer {r.json()['access_token']}"}
print("  ✓ Logged in")

# ── 2. Delete old WebTailBench projects ───────────────────────────────────────
step("2. Checking for existing WebTailBench projects to clean up…")
r = requests.get(f"{BASE}/projects", headers=H)
if ok(r, "list projects"):
    old = [p for p in r.json().get("items", r.json() if isinstance(r.json(), list) else [])
           if "WebTailBench" in p.get("name", "")]
    for p in old:
        rd = requests.delete(f"{BASE}/projects/{p['id']}", headers=H)
        status = "✓ deleted" if rd.status_code in (200,204) else f"✗ {rd.status_code}"
        print(f"  {status}: {p['name']} ({p['id']})")
    if not old:
        print("  No old projects found")

# ── 3. Create project ─────────────────────────────────────────────────────────
step("3. Creating project: WebTailBench…")
r = requests.post(f"{BASE}/projects", headers=H, json={
    "name": "WebTailBench",
    "description": (
        "WebTailBench v2 — 609 web browsing benchmark tasks across 11 categories.\n\n"
        "Each SOURCE is one task to complete. Open a source, read the task in the description, "
        "browse the web to complete it, then create a record with your answer.\n\n"
        "Extractors: complete the task, fill extracted_answer + extracted_url.\n"
        "Reviewers: score against the criteria in the source description."
    ),
    "submission_destinations": ["json_download"],
})
if not ok(r, "create project"): sys.exit(1)
project_id = r.json()["id"]
print(f"  ✓ Project: {project_id}")

# ── 4. Create schema (answer fields only) ────────────────────────────────────
step("4. Creating schema (7 answer/scoring fields only)…")
schema_def = json.loads((HERE / "schema_v2.json").read_text())
r = requests.post(f"{BASE}/schemas/{project_id}", headers=H, json={
    "name": "WebTailBench Answer Schema v1.0",
    "definition": schema_def,
})
if not ok(r, "create schema"): sys.exit(1)
schema_id = r.json()["id"]
print(f"  ✓ Schema: {schema_id}")

# ── 5. Create 609 sources ────────────────────────────────────────────────────
step("5. Creating 609 sources (one per task)…")
sources = json.loads((HERE / "sources_609.json").read_text())

created = 0
failed  = 0
for i, src in enumerate(sources, 1):
    r = requests.post(f"{BASE}/sources", headers=H,
        params={"project_id": project_id},
        json={
            "schema_id":   schema_id,
            "name":        src["name"],
            "description": src["description"],
            "website_url": src["website_url"],
        })
    if ok(r, f"source #{src['task_id']}"):
        created += 1
    else:
        failed += 1

    # Progress every 50
    if i % 50 == 0 or i == len(sources):
        print(f"  {i}/{len(sources)} — ✓ {created}  ✗ {failed}")

    time.sleep(0.05)   # ~30s total for 609

# ── Done ──────────────────────────────────────────────────────────────────────
step("Done!")
print(f"  Project:   WebTailBench  ({project_id})")
print(f"  Schema:    WebTailBench Answer Schema v1.0  ({schema_id})")
print(f"  Sources:   {created} created  ({failed} failed)")
print(f"\n  Workflow:")
print(f"  1. Extractor opens a source → reads task in description")
print(f"  2. Completes the task in the browser")
print(f"  3. Creates a record: fills extracted_answer + extracted_url")
print(f"  4. Reviewer scores against criteria in the source description")
print(f"\n  Open: https://-platform.vercel.app")
