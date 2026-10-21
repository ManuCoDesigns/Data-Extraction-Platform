"""python backend/tests/peer_notes/run.py  (from the repo root, or anywhere)
Runs every labelled peer note through the matcher and prints pass/fail plus credit precision and recall per field."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
from app.services import peer_notes as pn

cases = [json.loads(l) for l in open(os.path.join(HERE, "training_examples.jsonl"), encoding="utf-8") if l.strip()]
bad = 0
for c in cases:
    got = pn.fields_for(c["note"], c.get("record"), c.get("names") or pn.DEFAULT_NAMES)
    ok = got == sorted(c["fields"])
    bad += (not ok)
    print(("PASS" if ok else "FAIL"), c["id"], "expected", c["fields"], "got", got)
m = pn.score(cases)
print(f"{len(cases) - bad}/{len(cases)} passed")
print("credit precision", m["overall"]["precision"], "recall", m["overall"]["recall"])
for f, v in m["per_field"].items():
    print(f"  {f:14} precision {v['precision']}  recall {v['recall']}  (tp {v['tp']}, fp {v['fp']}, fn {v['fn']})")
if len(cases) < 30:
    print(f"Only {len(cases)} notes. Add at least 30 before trusting the precision numbers.")
sys.exit(1 if bad else 0)
