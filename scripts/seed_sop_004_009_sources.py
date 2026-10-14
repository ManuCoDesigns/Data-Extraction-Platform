#!/usr/bin/env python3
"""
seed_sop_004_009_sources.py — Seed the Data Extraction Platform with the
July 27 prioritized critical-materials source batch, mapped to
SOP-DS-004 through SOP-DS-009 (Xtrium Critical Materials SOP Set v1.0).

What this does:
  1. Reads Sheet2 ("prioritized / sent to Puneet's Team 7/27" tab) of the
     source-tracking Excel — it already carries a `SOP Reference ID` column
     mapping each source to SOP-DS-004..009.
  2. Creates one Schema per SOP (built from that SOP's worked JSON example
     in the SOP PDF) — six schemas total.
  3. Creates one Project (or reuses it if it already exists).
  4. Creates one Source per row, pointed at the correct schema, with
     website_url set and SOP/notes context stored in description/notes.

All 12 rows in this batch have an explicit SOP mapping, so none are created
as no-schema/flexible — but the --no-schema-for flag lets you force specific
row indices (0-based, in file order) to skip schema assignment if you want
pure flexible extraction for a given source instead.

SCHEMA DESIGN NOTE - read before running:
This repo already has an established "Materials Graph Schema v1.0"
(schemas/nasa_schema.json, built for SOP-DS-001/NASA TPSX) using field names
material_name, canonical_name, chemical_formula, material_type, properties[],
applications_mentioned, compliance_references, standards_referenced, sources.
SOP-DS-004/006/007/008 below are all material-centric, so their schemas here
reuse that exact field vocabulary rather than inventing parallel field names -
each keeps its OWN Schema object (so it can carry source-type-specific
extraction_instructions), but SOP-specific fields that aren't in the base
Materials Graph vocabulary (jurisdiction, resource_locations, localities,
evidence_records, program_or_project, quantitative_results, ...) are marked
extras:true, following the same convention already used in
schemas/critical_materials_schema.json for non-base fields.

SOP-DS-005 (compliance) and SOP-DS-009 (market intelligence) have NO existing
equivalent schema anywhere in the repo - there's no Compliance Graph or
Market Intelligence schema on the platform yet. Per the SOP's own Appendix B
("Schema field missing for valuable data -> escalate to Project Lead"), these
two are built here as proposals only. Confirm with Raghu/Sirisha/Puneet
before treating them as canonical - don't let contractors extract against
them until that's settled.

Usage:
  python seed_sop_004_009_sources.py \
    --url https://data-extraction-platform-production.up.railway.app \
    --email you@example.com --password yourpass \
    --xlsx global_materials_critical_sustainable_materials_sources_July27.xlsx

Requirements: pip install requests openpyxl
"""
import sys, json, re, argparse, time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("pip install requests")
try:
    from openpyxl import load_workbook
except ImportError:
    sys.exit("pip install openpyxl")

PROJECT_NAME = "Xtrium Critical Materials — SOP-DS-004-009 Batch"
PROJECT_DESCRIPTION = (
    "Critical-materials source batch prioritized 2026-07-27, mapped to "
    "SOP-DS-004 through SOP-DS-009 (Xtrium Critical Materials SOP Set v1.0): "
    "government agencies, responsible-minerals compliance, Mindat mineral "
    "localities, RRUFF spectral/property data, national labs, and market "
    "intelligence."
)

# ─── Schema definitions — one per SOP, built from each SOP's worked JSON example ──

# Base field set shared with the platform's existing Materials Graph Schema v1.0
# (schemas/nasa_schema.json). Reused verbatim by name across the four
# material-centric SOPs below so extraction targets one consistent vocabulary
# rather than four incompatible ad-hoc ones.
_MATERIALS_GRAPH_BASE_FIELDS = [
    {"name": "material_name", "type": "string", "required": True},
    {"name": "canonical_name", "type": "string", "required": True,
     "description": "lowercase, spaces to hyphens, remove specials — matches nasa_schema.json convention"},
    {"name": "chemical_formula", "type": "string", "required": False, "fixed_value": None},
    {"name": "material_type", "type": "string", "required": False, "fixed_value": None},
    {"name": "properties", "type": "array", "required": False, "fixed_value": [],
     "description": "Array of {name, canonical_name, value, unit, condition, property_category, raw, source} — same shape as nasa_schema.json. Use this for source-specific numeric/qualitative data that doesn't warrant its own top-level field."},
    {"name": "applications_mentioned", "type": "array", "required": False, "fixed_value": []},
    {"name": "compliance_references", "type": "array", "required": False, "fixed_value": []},
    {"name": "standards_referenced", "type": "array", "required": False, "fixed_value": []},
    {"name": "processing_notes", "type": "string", "required": False, "fixed_value": None,
     "description": "Free-text raw notes bucket — required by SOP Rule 5 (no schema drift) for anything that doesn't map cleanly to an approved field."},
    {"name": "sources", "type": "array", "required": True,
     "description": "[{source_name, source_url, doi, tier}] — matches nasa_schema.json convention"},
]

SCHEMA_DEFS = {
    "SOP-DS-004": {
        "name": "SOP-DS-004 Government Critical Minerals & Resource Agency Schema",
        "grouping_key": "material_name",
        "base_schema": "materials-graph-v1",  # extends schemas/nasa_schema.json field vocabulary
        "extraction_instructions": (
            "Government/national-resource-agency sources (DLA, CSIRO, Geoscience "
            "Australia, future USGS/DOE/EU). One record per material or "
            "list/program entry. Uses the same base field vocabulary as the "
            "Materials Graph Schema v1.0 (schemas/nasa_schema.json) — do not "
            "add further top-level fields beyond the extras below without "
            "Project Lead sign-off. NO INVENTED DATA — null over guessing. Do "
            "not generalize a jurisdiction-specific criticality status to "
            "global. Do not create a producer/project record unless the "
            "source names an operator/owner/producer role explicitly."
        ),
        "fields": _MATERIALS_GRAPH_BASE_FIELDS + [
            {"name": "criticality_status", "type": "string", "required": False, "fixed_value": None,
             "extras": True, "extras_source": "government-agency",
             "description": "Not in base Materials Graph Schema — record jurisdiction alongside status, never as a global fact."},
            {"name": "jurisdiction", "type": "string", "required": False, "fixed_value": None,
             "extras": True, "extras_source": "government-agency"},
            {"name": "resource_locations", "type": "array", "required": False, "fixed_value": [],
             "extras": True, "extras_source": "government-agency",
             "description": "Each: {location_name, country, raw}. Escalate to Project Lead if this should become a canonical Location Graph field."},
            {"name": "producer_or_project", "type": "string", "required": False, "fixed_value": None,
             "extras": True, "extras_source": "government-agency"},
        ],
    },
    "SOP-DS-005": {
        "name": "SOP-DS-005 Responsible Minerals & Supply Chain Compliance Schema — PROPOSED, PENDING SIGN-OFF",
        "grouping_key": "framework_name",
        "base_schema": None,  # no existing Compliance Graph schema found in repo
        "extraction_instructions": (
            "PROPOSED SCHEMA — no equivalent Compliance/Regulation Graph schema "
            "exists on the platform yet (checked schemas/: only Supplier Graph "
            "and Materials Graph schemas found). Per SOP Appendix B ('schema "
            "field missing for valuable data -> Project Lead'), confirm with "
            "Raghu/Sirisha/Puneet before using this for live extraction. "
            "Responsible sourcing / due-diligence / regulatory sources (RMI, "
            "OECD, EU Battery Regulation, Assent). One record per framework, "
            "regulation, or compliance program. Extract obligations and "
            "covered materials exactly as stated — no legal interpretation of "
            "applicability. Never invent a certification; create certification "
            "records only when a named program/conformance list is explicit."
        ),
        "fields": [
            {"name": "framework_name", "type": "string", "required": True},
            {"name": "jurisdiction", "type": "string", "required": False},
            {"name": "covered_materials", "type": "array", "required": False, "fixed_value": []},
            {"name": "obligation_type", "type": "string", "required": False},
            {"name": "effective_date_or_version", "type": "string", "required": False, "fixed_value": None},
            {"name": "auditable_entity", "type": "string", "required": False, "fixed_value": None},
            {"name": "raw_requirement_text", "type": "string", "required": False},
            {"name": "relationships", "type": "array", "required": False, "fixed_value": []},
            {"name": "source_url", "type": "string", "required": True},
        ],
    },
    "SOP-DS-006": {
        "name": "SOP-DS-006 Mindat Mineral Locality & Deposit Schema",
        "grouping_key": "canonical_name",
        "base_schema": "materials-graph-v1",
        "extraction_instructions": (
            "Mindat mineral species / locality / mine pages. Uses the same "
            "base field vocabulary as the Materials Graph Schema v1.0 "
            "(schemas/nasa_schema.json). Mindat is an enrichment source, not "
            "a supplier catalog — never create a supplier/producer record "
            "from a locality page unless a current operator is explicitly "
            "named. Preserve chemical formulas exactly."
        ),
        "fields": _MATERIALS_GRAPH_BASE_FIELDS + [
            {"name": "mineral_group_or_class", "type": "string", "required": False, "fixed_value": None,
             "extras": True, "extras_source": "mindat"},
            {"name": "localities", "type": "array", "required": False, "fixed_value": [],
             "extras": True, "extras_source": "mindat",
             "description": "Each: {locality_name, country, region, raw}."},
            {"name": "associated_minerals", "type": "array", "required": False, "fixed_value": [],
             "extras": True, "extras_source": "mindat"},
        ],
    },
    "SOP-DS-007": {
        "name": "SOP-DS-007 RRUFF Mineral Property & Spectral Data Schema",
        "grouping_key": "material_name",
        "base_schema": "materials-graph-v1",
        "extraction_instructions": (
            "RRUFF Project mineral/sample pages. Uses the same base field "
            "vocabulary as the Materials Graph Schema v1.0 (schemas/"
            "nasa_schema.json) — spectral/sample data goes in properties[] "
            "(property_category: 'spectral') rather than a new top-level "
            "field. Never invent numeric spectral peaks from an image; "
            "attach the file/image URL as evidence instead. Keep "
            "species-level identity separate from sample-specific "
            "measurements — one material record, multiple properties[] "
            "entries."
        ),
        "fields": _MATERIALS_GRAPH_BASE_FIELDS + [
            {"name": "evidence_records", "type": "array", "required": False, "fixed_value": [],
             "extras": True, "extras_source": "rruff",
             "description": "Each: {evidence_type, record_id (RRUFF ID), file_url, sample_locality, source_url}. Consider migrating into properties[] once confirmed with Project Lead."},
        ],
    },
    "SOP-DS-008": {
        "name": "SOP-DS-008 National Lab & Research Program Schema",
        "grouping_key": "material_name",
        "base_schema": "materials-graph-v1",
        "extraction_instructions": (
            "National lab / research-program sources (Argonne and similar; "
            "also technical societies like TMS). Uses the same base field "
            "vocabulary as the Materials Graph Schema v1.0 (schemas/"
            "nasa_schema.json) — applications_mentioned and "
            "compliance_references already exist there and should be used "
            "as-is. Separate scenario/forecast model output from current "
            "fact — always label scenario, method, and assumptions in "
            "processing_notes. Do not create a supplier from a research "
            "collaboration partner unless a commercial role is explicit."
        ),
        "fields": _MATERIALS_GRAPH_BASE_FIELDS + [
            {"name": "program_or_project", "type": "string", "required": False, "fixed_value": None,
             "extras": True, "extras_source": "national-lab"},
            {"name": "process_method", "type": "string", "required": False, "fixed_value": None,
             "extras": True, "extras_source": "national-lab"},
            {"name": "quantitative_results", "type": "array", "required": False, "fixed_value": [],
             "extras": True, "extras_source": "national-lab",
             "description": "Each: {metric, value, unit, scenario}. Prefer properties[] where the value is a stable material property rather than a one-off research result."},
            {"name": "technology_readiness", "type": "string", "required": False, "fixed_value": None,
             "extras": True, "extras_source": "national-lab"},
        ],
    },
    "SOP-DS-009": {
        "name": "SOP-DS-009 Market Intelligence & Critical Materials Supply Chain Schema — PROPOSED, PENDING SIGN-OFF",
        "grouping_key": "material_name",
        "base_schema": None,  # no existing Market Intelligence schema found in repo
        "extraction_instructions": (
            "PROPOSED SCHEMA — no equivalent Market Intelligence schema "
            "exists on the platform yet (checked schemas/: only Supplier "
            "Graph and Materials Graph schemas found). Per SOP Appendix B "
            "('schema field missing for valuable data -> Project Lead'), "
            "confirm with Raghu/Sirisha/Puneet before using this for live "
            "extraction. Market intelligence / supply-chain forecasting "
            "sources (BloombergNEF and comparable). Use only when access and "
            "citation rights are clear — never copy paywalled dashboard "
            "values. Preserve time_period, scenario, and region on every "
            "metric; never average across sources."
        ),
        "fields": [
            {"name": "material_name", "type": "string", "required": True},
            {"name": "metric_type", "type": "string", "required": False},
            {"name": "value", "type": "string", "required": False, "fixed_value": None},
            {"name": "unit", "type": "string", "required": False, "fixed_value": None},
            {"name": "time_period", "type": "string", "required": False, "fixed_value": None},
            {"name": "region", "type": "string", "required": False, "fixed_value": None},
            {"name": "scenario", "type": "string", "required": False, "fixed_value": None},
            {"name": "source_access_status", "type": "string", "required": True,
             "enum": ["public", "restricted", "paywalled", "licensed"]},
            {"name": "raw_summary", "type": "string", "required": False, "fixed_value": None},
            {"name": "source_url", "type": "string", "required": True},
        ],
    },
}

PROPOSED_PENDING_SIGNOFF = {"SOP-DS-005", "SOP-DS-009"}


def mkcn(name: str) -> str:
    n = str(name).lower().strip().replace("&", "and")
    n = re.sub(r"\s+", "-", n)
    n = re.sub(r"[^a-z0-9\-]", "", n)
    return re.sub(r"-+", "-", n).strip("-")


def parse_prioritized_sheet(xlsx_path: str):
    """Reads Sheet2 — the pre-filtered, SOP-mapped prioritized batch."""
    wb = load_workbook(xlsx_path, data_only=True)
    if "Sheet2" not in wb.sheetnames:
        sys.exit("Expected a 'Sheet2' tab with the SOP-mapped prioritized rows — not found.")
    ws = wb["Sheet2"]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(h).strip() if h else "" for h in rows[0]]

    def col(name):
        return header.index(name) if name in header else None

    idx = {
        "category": col("Category"), "name": col("Name"), "type": col("Type"),
        "url": col("URL"), "coverage": col("Coverage / Focus"), "region": col("Region"),
        "reason": col("Recommendation / Reason"), "sop": col("SOP Reference ID"),
    }
    if idx["sop"] is None:
        sys.exit("Sheet2 has no 'SOP Reference ID' column — cannot map schemas.")

    out = []
    for r in rows[1:]:
        if not r or not r[idx["name"]]:
            continue
        out.append({
            "category": r[idx["category"]],
            "name": str(r[idx["name"]]).strip(),
            "type": r[idx["type"]],
            "url": r[idx["url"]],
            "coverage": r[idx["coverage"]],
            "region": r[idx["region"]],
            "reason": r[idx["reason"]],
            "sop": str(r[idx["sop"]]).strip() if r[idx["sop"]] else None,
        })
    return out


class API:
    def __init__(self, base, email, password):
        self.b = base.rstrip("/")
        self.s = requests.Session()
        self.s.headers["Content-Type"] = "application/json"
        r = self.s.post(f"{self.b}/api/v1/auth/login", json={"email": email, "password": password})
        r.raise_for_status()
        self.s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
        print(f"✓ Authenticated as {email}")

    def get(self, p, **kw):
        r = self.s.get(f"{self.b}{p}", **kw)
        r.raise_for_status()
        return r.json()

    def post(self, p, **kw):
        r = self.s.post(f"{self.b}{p}", **kw)
        r.raise_for_status()
        return r.json()


def get_or_create_project(api: API):
    projects = api.get("/api/v1/projects").get("items", [])
    proj = next((p for p in projects if p["name"] == PROJECT_NAME), None)
    if proj:
        print("  ✓ Using existing project")
        return proj
    proj = api.post("/api/v1/projects", json={
        "name": PROJECT_NAME, "description": PROJECT_DESCRIPTION, "status": "active",
    })
    print("  ✓ Created project")
    return proj


def get_or_create_schemas(api: API, project_id: str):
    """Returns {sop_id: schema_id} for all six SOP-DS-004..009 schemas."""
    existing = api.get("/api/v1/schemas", params={"project_id": project_id})
    existing_by_name = {s["name"]: s for s in existing}
    result = {}
    for sop_id, schema_def in SCHEMA_DEFS.items():
        name = schema_def["name"]
        if name in existing_by_name:
            result[sop_id] = existing_by_name[name]["id"]
            print(f"  ✓ Schema exists: {name}")
            continue
        if sop_id in PROPOSED_PENDING_SIGNOFF:
            print(f"  ⚠ {sop_id} has no canonical platform equivalent — creating as PROPOSED. "
                  f"Confirm with Project Lead before contractors extract against it.")
        schema = api.post(f"/api/v1/schemas/{project_id}", json={"name": name, "definition": schema_def})
        result[sop_id] = schema["id"]
        print(f"  ✓ Created schema: {name}")
    return result


def run(args):
    print("\n[1/4] Parsing prioritized batch from Sheet2…")
    xlsx = args.xlsx
    if not Path(xlsx).exists():
        sys.exit(f"Excel not found: {xlsx}")
    rows = parse_prioritized_sheet(xlsx)
    print(f"  {len(rows)} prioritized sources parsed")
    for i, r in enumerate(rows):
        print(f"    [{i}] {r['name']} -> {r['sop']}")

    no_schema_idx = set(args.no_schema_for or [])

    api = API(args.url, args.email, args.password)

    print("\n[2/4] Project…")
    proj = get_or_create_project(api)
    pid = proj["id"]

    print("\n[3/4] Schemas (one per SOP-DS-004..009)…")
    schema_ids = get_or_create_schemas(api, pid)

    print(f"\n[4/4] Creating {len(rows)} sources…")
    existing_raw = api.get("/api/v1/sources", params={"project_id": pid})
    existing_list = existing_raw if isinstance(existing_raw, list) else existing_raw.get("items", [])
    existing = {s["name"]: s for s in existing_list}

    created, skipped, errors = 0, 0, 0
    for i, r in enumerate(rows):
        name = r["name"]
        if name in existing:
            print(f"  - Skipping (already exists): {name}")
            skipped += 1
            continue

        sop_id = r["sop"]
        schema_id = None if i in no_schema_idx else schema_ids.get(sop_id)
        if sop_id and schema_id is None and i not in no_schema_idx:
            print(f"  ! No schema mapped for SOP '{sop_id}' on '{name}' — creating with no schema.")

        desc_parts = [p for p in [r.get("coverage"), r.get("reason")] if p]
        description = " — ".join(desc_parts)[:2000] if desc_parts else None
        notes = f"SOP: {sop_id or 'unassigned'} | Category: {r.get('category')} | Type: {r.get('type')} | Region: {r.get('region')}"

        try:
            src = api.post("/api/v1/sources", params={"project_id": pid}, json={
                "name": name,
                "description": description,
                "website_url": r.get("url"),
                "schema_id": schema_id,
            })
            created += 1
            print(f"  ✓ Created source: {name} (schema: {sop_id or 'none'})")
            time.sleep(0.1)
        except Exception as e:
            body = ""
            try:
                body = e.response.text[:300] if hasattr(e, "response") and e.response else ""
            except Exception:
                pass
            print(f"  ✗ {name}: {e} | {body}")
            errors += 1

    print("\nDone!")
    print(f"  Sources created: {created}")
    print(f"  Already existed (skipped): {skipped}")
    print(f"  Errors: {errors}")
    print(f"\n→ Open {args.url.replace('-production.up.railway.app','')} → Projects → {PROJECT_NAME}")


def main():
    p = argparse.ArgumentParser(description="Seed the Data Extraction Platform with the SOP-DS-004..009 source batch")
    p.add_argument("--url", default="https://data-extraction-platform-production.up.railway.app")
    p.add_argument("--email", required=True)
    p.add_argument("--password", help="Password (avoid this on shared/history-logged shells — prefer --password-env)")
    p.add_argument("--password-env", default="XTRIUM_PW",
                    help="Name of an environment variable to read the password from (default: XTRIUM_PW)")
    p.add_argument("--xlsx", required=True, help="Path to global_materials_critical_sustainable_materials_sources_July27.xlsx")
    p.add_argument("--no-schema-for", type=int, nargs="*",
                    help="0-based row indices (in Sheet2 order) to force no-schema/flexible extraction")
    args = p.parse_args()

    if not args.password:
        import os
        args.password = os.environ.get(args.password_env)
        if not args.password:
            sys.exit(
                f"No password given. Either pass --password (not recommended — ends up in shell "
                f"history) or set it in the environment first, e.g.:\n"
                f"  read -s -p 'Password: ' XTRIUM_PW && export XTRIUM_PW\n"
                f"then re-run without --password."
            )

    run(args)


if __name__ == "__main__":
    main()
