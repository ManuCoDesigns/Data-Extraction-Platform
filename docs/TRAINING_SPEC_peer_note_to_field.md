# Training spec: map a peer comment to the field it is really about

Built from the Panjiva record (item #1049-era review, 21 Oct 2026) and the OMRON record.

## The failure
Austine Opiyo's note says Panjiva is a platform name, not a market segment. The tool listed
"Fields it points at: source_url" and put a "Peer mentioned: Austine Opiyo" chip on source_url.
Cause: the note says "using the article link as source_url" inside a how-to step. The tool matched the
field NAME anywhere in the text. The real field, segment_name, is not named, so it got no chip.
Nuhash Imroz's note (also about segment_name) got no chip either.

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
- Report both per field. Current sample: 6 notes, 6 pass, far too few to generalise.
- Hard rule: never credit a peer from an instruction clause.
