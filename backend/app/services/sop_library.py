"""The SOP library: Xtrium's SOP documents bundled with the platform, and a classifier that suggests which one a source needs.
Used for sources that were uploaded from a sheet instead of being pulled from Xtrium, so they have no SOP attached.
The routing follows Xtrium's own rules: the Appendix B decision tree and the Appendix A source table in the Materials Database SOP,
and the "Use when" table of the Critical Materials SOP set. Nothing is applied until a lead confirms it."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

LIBRARY_VERSION = "2026-10"
_DIR = Path(__file__).resolve().parent.parent / "data" / "sops"

# code -> (title, use when)
SOPS: dict[str, tuple[str, str]] = {
    "SOP-DS-002": ("BGS Directory of Mines & Quarries to Xtrium Supplier Graph", "The BGS Directory of Mines and Quarries 2020 dataset"),
    "SOP-DS-003": ("Universal Data Extraction Standard", "Company, supplier, product, distributor and directory pages, and anything no other SOP covers"),
    "SOP-DS-004": ("Government Critical Minerals & Resource Agency Extraction", "Official public agencies and national resource programs (DLA, CSIRO, Geoscience Australia, USGS, geological surveys)"),
    "SOP-DS-005": ("Responsible Minerals & Supply Chain Compliance Extraction", "Due diligence, regulated materials, reporting and audit frameworks (RMI, OECD, EU Battery Regulation)"),
    "SOP-DS-006": ("Mindat Mineral Locality & Deposit Extraction", "Mineral species, locality and deposit pages, mainly Mindat"),
    "SOP-DS-007": ("RRUFF Mineral Property & Spectral Data Extraction", "Mineral identity, chemistry and Raman/XRD spectra from RRUFF"),
    "SOP-DS-008": ("National Lab & Research Program Extraction", "National laboratories, DOE programs, federal initiatives and research consortia"),
    "SOP-DS-009": ("Market Intelligence & Critical Materials Supply Chain Extraction", "Demand, supply concentration, capacity and risk from market intelligence sources"),
    "SOP-DS-010": ("Engineering Materials Property & Handbook Database Extraction", "Materials datasheets, handbooks, property tables, phase diagrams and reference databases"),
    "SOP-DS-011": ("Computational Materials & Crystal Structure Database Extraction", "Computed (DFT) materials databases, crystal-structure databases and high-throughput platforms"),
    "SOP-DS-012": ("Advanced Battery, Electrochemical & Functional Materials Extraction", "Battery, fuel cell, BMS and functional electrochemical materials organizations and technologies"),
    "SOP-DS-013": ("Mineral Projects, Resources & Mining Company Extraction", "Mining and exploration companies, mineral projects, resource estimates and technical reports"),
    "SOP-DS-014": ("Industrial Waste Valorization, Circular Materials & LCA Extraction", "Waste valorization, recycling, circular materials and life-cycle assessment sources"),
}

# website domain (a suffix of the host) -> (code, what it is). A match is high confidence.
DOMAINS: list[tuple[str, str, str]] = [
    ("mindat.org", "SOP-DS-006", "Mindat, the mineral locality database"),
    ("rruff.info", "SOP-DS-007", "the RRUFF mineral property and spectral project"),
    ("rruff.geo.arizona.edu", "SOP-DS-007", "the RRUFF mineral property and spectral project"),
    ("bnef.com", "SOP-DS-009", "BloombergNEF, a market intelligence source"),
    ("responsiblemineralsinitiative.org", "SOP-DS-005", "the Responsible Minerals Initiative"),
    ("oecd.org", "SOP-DS-005", "OECD due diligence guidance"),
    ("assent.com", "SOP-DS-005", "Assent, a supply chain compliance source"),
    ("matweb.com", "SOP-DS-010", "MatWeb, an engineering materials property database"),
    ("asminternational.org", "SOP-DS-010", "ASM International, a materials handbook"),
    ("springermaterials.com", "SOP-DS-010", "SpringerMaterials, property tables and reference data"),
    ("materials.springer.com", "SOP-DS-010", "SpringerMaterials, property tables and reference data"),
    ("makeitfrom.com", "SOP-DS-010", "an engineering materials property reference"),
    ("materialsproject.org", "SOP-DS-011", "the Materials Project, a computed materials database"),
    ("aflowlib.org", "SOP-DS-011", "AFLOW, a high-throughput computational database"),
    ("aflow.org", "SOP-DS-011", "AFLOW, a high-throughput computational database"),
    ("nomad-lab.eu", "SOP-DS-011", "NOMAD, a materials data repository"),
    ("fiz-karlsruhe.de", "SOP-DS-011", "ICSD, the inorganic crystal structure database"),
    ("oqmd.org", "SOP-DS-011", "OQMD, a DFT materials database"),
    ("crystallography.net", "SOP-DS-011", "a crystal structure database"),
    ("materialscloud.org", "SOP-DS-011", "a computational materials repository"),
    ("lbl.gov", "SOP-DS-008", "Lawrence Berkeley National Laboratory"),
    ("sandia.gov", "SOP-DS-008", "Sandia National Laboratories"),
    ("anl.gov", "SOP-DS-008", "Argonne National Laboratory"),
    ("ornl.gov", "SOP-DS-008", "Oak Ridge National Laboratory"),
    ("nrel.gov", "SOP-DS-008", "the National Renewable Energy Laboratory"),
    ("inl.gov", "SOP-DS-008", "Idaho National Laboratory"),
    ("pnnl.gov", "SOP-DS-008", "Pacific Northwest National Laboratory"),
    ("llnl.gov", "SOP-DS-008", "Lawrence Livermore National Laboratory"),
    ("lanl.gov", "SOP-DS-008", "Los Alamos National Laboratory"),
    ("energymaterialsnetwork.org", "SOP-DS-008", "the DOE Energy Materials Network"),
    ("mgi.gov", "SOP-DS-008", "the Materials Genome Initiative"),
    ("dla.mil", "SOP-DS-004", "the US Defense Logistics Agency"),
    ("csiro.au", "SOP-DS-004", "CSIRO, a national research agency"),
    ("ga.gov.au", "SOP-DS-004", "Geoscience Australia"),
    ("usgs.gov", "SOP-DS-004", "the US Geological Survey"),
    ("bgs.ac.uk", "SOP-DS-004", "the British Geological Survey"),
    ("nrcan.gc.ca", "SOP-DS-004", "Natural Resources Canada"),
    ("bgr.bund.de", "SOP-DS-004", "the German geological survey"),
    ("energy.gov", "SOP-DS-004", "the US Department of Energy"),
]

# keyword groups per SOP. Each distinct hit adds one point.
KEYWORDS: dict[str, list[str]] = {
    "SOP-DS-012": ["battery", "batteries", "fuel cell", "electrolyte", "electrochemical", "lithium-ion", "li-ion", "solid-state", "solid state", "anode", "cathode", "supercapacitor", "bms", "energy storage", "sodium-ion", "redox flow"],
    "SOP-DS-013": ["mining", "mine", "mines", "exploration", "explorer", "mineral project", "resource estimate", "ni 43-101", "jorc", "feasibility", "deposit", "junior miner", "lithium project", "metals ltd", "resources ltd", "resources inc", "minerals ltd", "mineral resources", "ore"],
    "SOP-DS-014": ["waste", "recycl~", "circular", "valoriz~", "valoris~", "lca", "life cycle", "life-cycle", "slag", "fly ash", "upcycl~", "reuse", "ecobalance", "residue", "end-of-life"],
    "SOP-DS-005": ["responsible sourcing", "due diligence", "conflict mineral", "3tg", "battery regulation", "traceability", "compliance", "responsible minerals", "audit"],
    "SOP-DS-008": ["national laborator~", "national lab", "research program", "consortium", "genome initiative", "energy materials network", "department of energy"],
    "SOP-DS-009": ["market intelligence", "market report", "market outlook", "demand forecast", "supply concentration", "price forecast", "bloomberg"],
    "SOP-DS-010": ["handbook", "datasheet", "property database", "properties database", "phase diagram", "engineering materials", "materials property", "alloy grades"],
    "SOP-DS-011": ["dft", "crystal structure", "computational", "high-throughput", "crystallograph~", "first-principles", "structure database"],
    "SOP-DS-006": ["mindat", "mineral locality", "mineral species", "locality", "mineral"],
    "SOP-DS-007": ["raman", "xrd", "spectra", "spectral", "rruff"],
    "SOP-DS-004": ["geological survey", "geoscience", "critical minerals list", "government", "ministry", "department of", "agency"],
}
COMPANY = re.compile(r"\b(inc|ltd|llc|plc|gmbh|corp|corporation|co\.|company|ag|sa|s\.a\.|oy|ab|bv|pty|limited|group|holdings|industries|technologies|materials|metals|supply|supplier|distributor)\b", re.I)


def _host(url: str | None) -> str:
    if not url:
        return ""
    u = url.strip()
    if "//" not in u:
        u = "//" + u
    try:
        h = (urlparse(u).hostname or "").lower()
    except Exception:
        return ""
    return h[4:] if h.startswith("www.") else h


def _hit(text: str, kw: str) -> bool:
    if kw.endswith("~"):  # a stem: matches any word that starts with it
        return re.search(r"(?<![a-z0-9])" + re.escape(kw[:-1]), text) is not None
    return re.search(r"(?<![a-z0-9])" + re.escape(kw.strip()) + r"(?:s|es|d|r|rs|ing)?(?![a-z0-9])", text) is not None


def classify(name: str | None, url: str | None, category: str | None = None, type_: str | None = None, description: str | None = None) -> dict:
    """-> {code, title, confidence: high|medium|low, reason, alternatives: [code]}"""
    host = _host(url)
    path = ""
    try:
        path = (urlparse(url if url and "//" in url else "//" + (url or "")).path or "").lower()
    except Exception:
        pass
    text = " ".join(x for x in (name, category, type_, description, path.replace("-", " ").replace("_", " ").replace("/", " ")) if x).lower()

    def pack(code, conf, reason, alts=()):
        return {"code": code, "title": SOPS[code][0], "confidence": conf, "reason": reason, "alternatives": [a for a in alts if a != code and a in SOPS][:3]}

    if ("directory of mines" in text or "directory-of-mines" in (url or "").lower()) and "bgs" in (host + " " + text):
        return pack("SOP-DS-002", "high", "This is the BGS Directory of Mines and Quarries dataset.", ["SOP-DS-004"])
    for dom, code, what in DOMAINS:
        if host == dom or host.endswith("." + dom):
            alts = ["SOP-DS-008"] if code == "SOP-DS-011" else ["SOP-DS-011"] if code == "SOP-DS-010" else []
            conf = "medium" if code == "SOP-DS-004" and dom in ("energy.gov", "bgs.ac.uk") else "high"
            return pack(code, conf, f"The website is {what}.", alts)
    if host.endswith(".gov") or ".gov." in host or host.endswith(".mil") or host.endswith("europa.eu"):
        return pack("SOP-DS-004", "medium", f"{host} is an official government or agency website.", ["SOP-DS-008", "SOP-DS-005"])

    scores = {c: [k for k in kws if _hit(text, k)] for c, kws in KEYWORDS.items()}
    ranked = sorted(((len(v), c) for c, v in scores.items() if v), reverse=True)
    # a plain "mineral" mention alone is weak evidence for Mindat
    if ranked and ranked[0][1] == "SOP-DS-006" and scores["SOP-DS-006"] == ["mineral"]:
        ranked = [r for r in ranked if r[1] != "SOP-DS-006"] or []
        weak_min = True
    else:
        weak_min = False
    if ranked:
        n, code = ranked[0]
        second = ranked[1][0] if len(ranked) > 1 else 0
        alts = [c for _, c in ranked[1:4]]
        said = ", ".join(f"“{k.strip().rstrip(chr(126))}”" for k in scores[code][:3])
        if n >= 2 and n > second:
            return pack(code, "medium", f"The name, category or page mentions {said}.", alts)
        return pack(code, "low", f"Only a weak hint ({said}). Confirm before applying.", alts + ["SOP-DS-003"])
    if weak_min:
        return pack("SOP-DS-006", "low", "The category mentions a mineral. Mindat's SOP fits mineral pages, but check the source.", ["SOP-DS-007", "SOP-DS-003"])
    if COMPANY.search(text) or (name and len(name.split()) <= 4):
        return pack("SOP-DS-003", "medium" if COMPANY.search(text) else "low",
                    "Looks like a company, supplier or product page. The Universal Data Extraction Standard covers these.", ["SOP-DS-013", "SOP-DS-012", "SOP-DS-014"])
    return pack("SOP-DS-003", "low", "Nothing matched a specific SOP. Per Xtrium's decision tree, use SOP-DS-003 and ask the project lead to confirm the SOP.", [])


def markdown(code: str) -> str:
    p = _DIR / f"{code}.md"
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return ""


def build_saved(code: str, user_id: str | None, confidence: str | None, reason: str | None) -> dict:
    """The xtrium_sop value for a library-assigned SOP. Marked origin=library so it is never mistaken for Xtrium's own copy."""
    title = SOPS[code][0]
    now = datetime.now(timezone.utc).isoformat()
    return {
        "sop": {"sop_code": code, "title": title, "markdown": markdown(code), "origin": "library"},
        "meta": {"sop_code": code, "title": title, "origin": "library", "assigned_by": user_id, "confidence": confidence, "reason": reason, "library_version": LIBRARY_VERSION},
        "saved_at": now,
    }


def is_library(saved) -> bool:
    return isinstance(saved, dict) and isinstance(saved.get("meta"), dict) and saved["meta"].get("origin") == "library"


def has_own_sop(saved) -> bool:
    """True when the source carries a real SOP (Xtrium's, or one a lead already assigned)."""
    return isinstance(saved, dict) and isinstance(saved.get("sop"), dict) and bool(saved["sop"].get("markdown"))
