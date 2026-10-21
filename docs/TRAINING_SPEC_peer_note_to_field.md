# Training spec: map a peer comment to the field it is really about

Built from the Panjiva record (item #1049-era review, 21 Oct 2026) and the OMRON record.

## The failure
Austine Opiyo's note says Panjiva is a platform name, not a market segment. The tool listed
"Fields it points at: source_url" and put a "Peer mentioned: Austine Opiyo" chip on source_url.
Cause: the note says "using the article link as source_url" inside a how-to step. The tool matched the
field NAME anywhere in the text. The real field, segment_name, is not named, so it got no chip.
Nuhash Imroz's note (also about segment_name) got no chip either.

## Rules added after the first accuracy run
9. A clause that approves a field (looks fine, is correct, ok, no problem, nothing wrong) never credits it. A sentence is split at but / however / although / though / yet, so "segment_name is ok but evidence is not on the page" credits evidence only.
10. "could not verify", "behind a login" and "paywall" are not complaints. A peer who could not check is not claiming an error.
11. "no evidence of X", "any evidence" and "evidence that" do not name the evidence field.
12. Any other SOP field is matched by name when it is written with underscores or spaces, quoted, followed by a colon or the word field, or is the subject of the clause ("Industry should be...", "Confidence 1.5 is out of range").
13. An allowed value that only one field can hold (ai_generated, source_derived for data_origin; llm_extraction, rule_extraction, er_deterministic, er_llm_reviewed for method) points at that field. A plain word such as manual counts only when the record carries that value.
14. The desk shows, on each credited field chip, the sentence and the reason (hover). A note with no credited field says so.

## Rules (in order)
1. Strip URLs before matching. A link is never a complaint about the URL field.
2. Split the note into clauses (sentences, list bullets, numbered steps).
3. Classify each clause: ACK ("Okay", "done"), INSTRUCTION (starts with remove / open / create / use /
   skip / replace / "what to do", or contains "using X as <field>"), else COMPLAINT.
4. Only COMPLAINT clauses can point at a field. ACK and INSTRUCTION clauses never credit a peer.
5. In a complaint clause, a field is matched by (a) its name, 0.9; (b) a topic cue, 0.7
   (segment_name: "market segment", "trading category", "platform", "pre-filled", "real segment";
   evidence: "verbatim", "word for word", "dash", "joins"); (c) the clause quotes the short delivered
   value of that field, 0.75 (OMRON: note says "aluminium", segment_name is "Aluminium").
6. Credit a peer only at confidence >= 0.7. If the peer note is posted ON a field in the screen, that field
   is also credited.
7. Several peers can credit one field (Austine and Nuhash both credit segment_name).
8. A peer whose remedy is outdated (commodity records for Panjiva) is still credited for the error they
   found. The remedy goes in the Return comment, not in the credit.

## Field-state rules (what the badges mean)
- data_origin, retrieved_at, method are auto-filled. "Not on the page" is NEUTRAL, never an error.
- "Found on the site" only proves the text appears. It does not prove the value is the right kind of
  value (Panjiva appears on the page, but a platform is not a segment). Do not show it as a pass for
  segment_name.
- "SOP ... does not list this field" on a field = Wrong, kind Schema, when the field is outside the
  SOP now saved on the source.
- A required field that is Empty = Wrong, kind Missing value.
- Audit checks that quote an allowed-value list must pass when the delivered value is IN that list. The
  UL audit said "curated is not allowed" while quoting a list that contains curated. Treat a verdict that
  contradicts its own quoted evidence as a tool defect, not a Wrong flag.

## Files
- matcher.py: reference implementation (python3 matcher.py runs the tests)
- training_examples.jsonl: labelled notes (note, correct fields, what the tool said, why)

## How to extend the data
Add one JSON line per peer note you review: id, author, note, record (short delivered values), fields
(what it is really about), tool_said (what the tool credited). Keep false cases (instruction-only,
acknowledgements). Target: at least 30 notes before trusting precision numbers.

## Metrics
- Credit precision = credited fields that were right / all credited fields.
- Credit recall = right fields credited / all right fields.
- Report both per field. Current sample: 86 notes (6 real from the Panjiva and OMRON reviews, 80 written to test the rules). `python backend/tests/peer_notes/run.py` prints precision and recall per field.
- Honest accuracy: the second batch of 30 notes was written in a different style and run before any rule change. It scored 24 of 30 (80%). The misses were fixed and the notes kept as regression cases, so the 100% on the full set now is not a fair estimate. Replace the synthetic notes with real ones as you review them, and watch the number on notes the rules have not seen.
- Hard rule: never credit a peer from an instruction clause.

## Real-note results (October review document)
- 24 real peer notes from the post-sync review were labelled and added (110 labelled notes in total; 30 real, 80 synthetic).
- Before the matcher changes the real notes scored 17/24; after them 24/24. The full set is 110/110.
- Still unverified: only Organization, ManufacturerListing, MarketSegment and Unclassified layouts have been seen. Regulation, Process and Material SOP layouts are untested.
- Next target: 30+ more real notes, then re-measure precision and recall per field.

## Schema rules learned from the document
15. A field outside the saved SOP is Wrong, kind Schema, even when its value is also unsupported on the page. Schema is reported first.
16. Required booleans must be an explicit true or false. `false` counts as filled; blank counts as missing.
17. headquarters_country style fields that cite ISO 3166-1 alpha-2 must be two capital letters. A country name is Wrong.
18. If the source category differs from the saved SOP entity, or the SOP code version differs from its text version, the SOP may be outdated: warn and suggest Refresh, do not guess.
19. An Unclassified source has no deliverable contract: no schema or missing-value flags. Hold and ask the lead.
20. A placeholder retrieved_at timestamp is Hold, not Wrong.
Test: python backend/tests/sop_contract/run.py
