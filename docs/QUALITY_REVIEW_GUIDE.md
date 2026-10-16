# Quality review guide

How quality works in the Data Extraction Platform, and the order to follow when you review a source.

Who uses it: admins and QA leads (org_admin, project_admin, qa_lead). Reviewers and extractors see only part of it (see "Who sees what").

---

## 1. The idea in one minute

Three things judge the quality of a delivery:

1. **The system** checks what it can check by rule: required fields, types, allowed values, formats, placeholders like "N/A", the SOP's field list, duplicates.
2. **The peer reviewers** read the data and say what looks wrong.
3. **You** (the admin) settle each doubted field against the real source. That is the ground truth. Everything is scored against it.

The system and the peers point at doubtful fields. Only your check at the real source decides whether a field is right or wrong. A pointer is never proof.

---

## 2. The order to follow

### Step 0. Before you start

- The source has a saved SOP (open the source's SOP page once if it never was). Without it the SOP check cannot run.
- Every peer reviewer has submitted. The Review tab lists "Peer reviewed" sources by default, which means all assigned peers are done.
- `NIMBLE_API_KEY` is set on the backend if you want "Check on the site".

### Step 1. Peer review happens first

Each peer reviews the source on their own and submits a comment. Peers cannot see each other's comments until they have submitted their own. This keeps their opinions independent, so do not share one peer's notes with another before they submit.

Reviewers can also log a specific error with **Flag error** on a record (field, kind, severity, note). The system tells them whether it agrees.

### Step 2. Run the system checks

Quality, then **Errors logged**, pick the source, **Run system checks**.

This logs, as system findings:

| Check | Category | Severity |
|---|---|---|
| Required field empty (schema) | Missing value | major |
| Wrong type or value not in the allowed list | Schema | major |
| Placeholder text such as N/A, TBD, unknown | Missing value | major |
| Extra spaces at the start or end | Format | minor |
| Website not a full address, bad email, bad date | Format | major |
| Pattern, minimum or maximum length from the schema | SOP rule | major or minor |
| Field the SOP requires is empty | SOP rule | major |
| Field filled in but not listed by the SOP | SOP rule | minor |
| Two records with the same name | Duplicate | major |

Running it again adds only new problems. It never duplicates.

### Step 3. Look at the SOP check

Quality, **SOP check**.

- With all sources selected: one line per source, with how many records follow the SOP.
- With one source selected: each required field with how often it is filled, the fields the SOP does not list, and the records falling short.

A record follows the SOP when every required field is filled in. Fix gaps first by sending the records back to the extractor. There is no point checking the facts of a record that is missing required fields.

### Step 4. Open the review desk

Quality, **Review**.

1. Pick a project card, or All projects.
2. Keep "Peer reviewed" (or choose "All sources" to see the rest).
3. Pick a source.

**Layout.** The desk is built so the fields stay on screen while you work:

- A compact bar at the top holds the **source switcher** (click the source name to search and jump to another source in the same list), Previous and Next source, **Ask the client** and **Approve source**.
- The **Overview** bar below it is one line: doubted fields, peer pointers, checked fields. Click **Show peer notes and steps** to open the Review steps and what each peer wrote. Close it again to get the room back.
- The record toolbar stays pinned while you scroll, with every action on it and none hidden in a menu: the filters (**Doubted only**, **JSON**, **Hide checked**), **Next doubted**, **Side by side**, **Check site** with its **Render page** option, **Run system checks** and **Open source site**. The keyboard shortcuts are listed under it.
- The record actions (**Comment**, **Return for correction**, **Approve record**) are in a bar at the bottom, so they are never off screen.
- On a wide screen (about 1500 pixels or more) **Side by side** opens as a panel next to the fields, so you can compare without losing your place. On a narrower screen it opens over the page, and Esc closes it.
- The red notification banner is not pinned on this page, so it does not cover the toolbar.

At the top of a source you see a **Review steps** strip (peers submitted, system checks with a Run now button, SOP, doubted fields, spot check, open errors). The next step is highlighted.

Below it you see:

- Fields doubted, peer comments, peer mentions, fields already checked, and a progress bar for doubted fields settled.
- What each peer wrote, with the field names it points at.

Records are sorted riskiest first. Work from the top.

### Step 5. Work through each record

For one record:

0. **Side by side** (press `s`). Opens the record full screen with the SOP, the source text, the website and the page text beside it. The SOP tab lists the SOP's required fields with a tick or cross for this record. In the Page text tab, the value of the field you are on is highlighted. Press `Esc` to close.
1. **Check on the site** (optional but quick). Nimble fetches the source website and marks each value "Found on the site", "Close match" or "Not on the page", with the surrounding text. This only tells you where to look first. "Not on the page" can also mean a different spelling or a sub-page.
2. Go field by field. The doubted fields have chips that say why:
   - **Peer comment**: a reviewer commented on this exact field.
   - **Peer mentioned**: the field is named in a peer's note.
   - **Error logged**: a reviewer or the system logged an error.
   - **SOP**, **System check**, **AI or web flag**: the automatic signals.
3. Open the real source (**Open the source site**, or **Find it on the site** on the field) and compare.
4. Mark the field:
   - **Correct**: the source supports the value.
   - **Wrong**: type what the source really says. Pick the kind of error. Tick the peers who should get credit for catching it.
5. **Comment on a field** (press `m`, or the Comment link). Write what is wrong and pick the SOP rule it breaks. The note is saved on the record and the extractor and peers see it on the source page. It is a pointer for them, not a verdict. You can still mark the field Correct or Wrong separately. Remove your own note with Remove.
6. If the same value appears on other records, tick **Apply to N more records with this value** to settle them in one go. It only touches fields you have not checked yet, and peer credit still goes only to the record you clicked.
7. Move on. The next doubted field is selected for you.

Keys: `y` confirm the audit's suggestion on the field, `s` side by side, `↑` `↓` change field, `c` correct, `w` wrong (type the real value, press Enter), `n` next doubted field (continues into the next record that still has work), `j` and `k` change record.

**Record actions** sit above the fields: **Comment on the record** (a note about the whole record), **Return for correction** (needs a note; sends it to the extractor and resets the peer reviews) and **Approve record** (your final sign-off; peers must have submitted). The header shows how many records are approved and has **Approve source** once all are, and **Ask the client**. The same chat and activity as the source page are under the records.

**After a return.** When the extractor fixes and resubmits, the desk does the comparing for you:

- A field you checked earlier whose value has changed loses its old verdict and goes back on the list marked **Changed since flagged**, with the old and the new value side by side. Your old verdict is shown as "Last check".
- A field a reviewer flagged, whose value the extractor then changed, shows the same marker. Check the new value against the source.
- The record shows the fields the extractor changed since you sent it back, as chips you can click. If nothing changed it says so.
- If the reviewer was right and the extractor fixed it before you looked, marking the new value **Correct** still counts the reviewer as having caught an error. If the old value was actually fine and the flag was a mistake, tick **The old value was fine** before you mark it.
- Feedback never disappears. The extractor keeps a **Feedback on this source** list on the source page, with each item marked Not changed yet, Changed (waiting for your re-check), or Fixed and checked.

### What each source must follow (SOP rules)

Every source has an SOP saved on it. **SOP rules** at the top of the desk shows exactly what that source's SOP requires, read from the SOP text and never guessed:

- The SOP code, version, the entity it describes and the category set on the source.
- **Fields**: each field the SOP names, whether it is required or optional, its allowed values and format, the rule, the section it came from and the exact line (hover a row).
- **Rules that name this source**: the sentences in the sections that match the source's category or entity, marked **Must** (must, shall, never, only, exactly, at least and similar) or **Should** (advice). General and other sections are listed below them.
- **Settle these first**: a plain list of things that stop a strict check, such as no SOP saved, no SOP text, a different SOP code in the text, no section for the category, no version, or a required field the SOP text never explains.

A rule under another category's heading is shown but marked "not enforced here", so a Regulation rule is never held against a MarketSegment source. In the **SOP check** tab, with no source chosen, a table lists every source with its category, SOP, rule counts and anything to settle, and **Download Excel** gives every field, rule and warning with its section and quote.

### Optional: audit the whole source against the live site

**Audit against site** (top of the desk) reads the pages the records cite and checks every field against the SOP, using the written audit algorithm in `docs/SOURCE_AUDIT_ALGORITHM.md`. It needs Nimble to be set up. It only suggests: nothing is rated until you confirm each field.

For every field you get **Correct**, **Wrong** or **Hold**, with the exact text from the page as proof and, for a wrong field, what the source really says:

- **Wrong** is only used when the live page proves it: a value or sentence that is not on the cited page, evidence glued together from two parts of a page, a segment name that is a platform, service or duplicate, a mismatched data_origin and method pair, a timestamp in the wrong shape or the same placeholder on every record, or a link that redirects elsewhere.
- **Hold** is used when the page cannot settle it: a page that did not load, a View more or sign-in wall, a broad sector name, extra region keys that depend on the SOP version, or a weak match. Holds are never counted as errors.
- Each field also shows a **flag status**: Valid (a reviewer or the system flagged a real error, with the reviewer named), Not flagged (an error nobody caught), False flag (flagged but fine) or Stale (changed since it was flagged).

The panel also gives a suggested decision (Send back, Hold or Approve), the repeated defects counted as one pattern, records the pages suggest adding (one verbatim sentence each), who owns the errors, and a list of what was **not scanned**. A page that could not be read or a part of the site that was not visited is reported as a gap, never as clean. The site map is not scanned yet, so suggested records come only from the pages the records cite.

After you run the audit, each field in the desk also shows its own suggestion (what it found, what the source says, the proof and the flag status) so you can work down the fields without going back to the panel. Press **y** on a field to confirm its suggestion and move on to the next suggested field, or use the Confirm button.

The audit also applies the SOP strictly: a required field that is empty, a value outside the SOP's allowed values, and a field the SOP does not list (Hold, because it may be a different SOP version) are reported with the SOP section and quote.

**Everything the audit says is a suggestion.** Running it changes nothing and rates nothing. A field only counts in the accuracy and error ratings after you confirm it yourself, one field at a time: press **Confirm wrong** or **Confirm correct** when you have looked and agree, or **Check myself** to open the field in the desk and mark it your way. There is no apply-all. Peers whose own note pointed at a real error get the credit when you confirm it. **Save as note** leaves a Hold as a comment on the field, which is not a rating. **Download JSON** gives the full audit, one record per field.

### Step 6. Spot check some fields that nobody doubted

Untick **Only doubted fields** and check a spread of ordinary fields. This matters. If you only check doubted fields, errors nobody noticed never show up, and the scores look better than the data really is.

Aim for at least 30 checked fields across the source or project. Under 30, the Scores page shows a low-confidence warning.

### Step 7. Settle what is still open

Quality, **Errors logged**. For every open finding:

- **Real error**: it is an error. Add what the source really says if you know.
- **Not an error**: the value is fine.

Findings you settled through **Wrong** or **Correct** in the review desk are already closed. System findings that you did not touch stay open until you settle them here.

### Step 8. Read the scores

Quality, **Scores**. Filter by project, source and period. See section 4 for what each number means.

### Step 9. Decide

- Approve the source when the doubted fields are settled and the scores are acceptable.
- Send records back to the extractor when errors are confirmed. A send-back resets the peer reviews.

### Optional: cross-check with an AI model

In the Review tab, **Download Excel** (or **JSON**) gives every peer-reviewed source in the list with the peers' comments beside the data. Give it to a model together with the source website and ask it to answer correct, wrong or unsure for each row marked Doubted. Compare its answers with your verdicts. Treat its answers as pointers, the same as the other signals.

---

## 3. What each action changes

| You do this | What happens |
|---|---|
| Mark a field **Correct** | The field counts as audited and right. Open reviewer findings on that field are dismissed. Reviewers who commented on that field get a dismissed finding (lowers their precision). |
| Mark a field **Wrong** | The field counts as audited and wrong. Open reviewer findings on that field are confirmed. Peers who commented on it, and peers you tick, get a confirmed finding (they caught it). |
| Mark Wrong and tick nobody | The error counts as having escaped review. |
| **Real error** on a finding | Counts as a confirmed error. |
| **Not an error** on a finding | Dismissed. If a reviewer raised it, it lowers their precision. |
| Change a verdict later | Allowed. The new verdict replaces the old one. The findings settled earlier are not reopened automatically. |

---

## 4. The scores

| Score | Formula | Reads as |
|---|---|---|
| Final accuracy | audited fields that were right / all audited fields | How good the delivered data really is |
| Review catch rate | errors reviewers caught / (caught + audited errors nobody flagged) | How much of the wrong data review stopped |
| Reviewer precision | confirmed / (confirmed + dismissed) among reviewer findings | How often a reviewer's flag turns out to be real |
| System precision | confirmed / (confirmed + dismissed) among system findings | How often the automatic checks are right |
| Process score | 50% final accuracy + 30% catch rate + 20% reviewer precision (only the parts that have data) | One overall number |
| Errors per 100 fields | confirmed errors / fields filled in, times 100 | Error density |

Colour bands on the tiles: 90% and above green, 75 to 89 amber, below 75 red.

The Scores page also breaks errors down by kind and severity, and has a table per extractor (errors per 100 fields, accuracy on checked fields) and per reviewer (logged, confirmed, dismissed, open, precision).

### Looking at a past period

On the **Scores** tab the **Period** control sets the window for both the scores and the Extractor report. Pick All time, the last 30, 90 or 365 days, or choose exact **From** and **To** dates (or Today, Yesterday, Last 7 days). Dates are Nairobi days.

A check counts on the day it was **first made**, not the day it was last touched, so fields you checked on the 14th still show for the 14th after you re-check them later. Errors logged by reviewers or the system count on the day they were logged. Everything is read from the database, so nothing needs to be re-entered.

One limit: checks made before the review-memory update only kept their latest verdict, so for those the date is the last check and the first-pass result is the verdict they had at the update. From then on the first verdict and its date are kept for good.

### Extractor report

Quality, Scores, **Extractor report**. It counts every error ever found, so rework does not hide a weak first pass. An error is one field on one record, counted once, whether it came from a confirmed finding or from a first check you marked wrong.

| Column | Meaning |
|---|---|
| Errors, per 100 | Errors found, and errors / fields filled in x 100 |
| First pass | Checked fields that were right the first time they were checked |
| Final | Checked fields that are right now. Checks on values changed since are left out until you check again |
| Caught by reviewers | Errors a reviewer pointed at before you did |
| Fixed, Still wrong | What happened to those errors |
| Sent back | Records returned at least once, out of all records |

Click an extractor to see each source. **Download Excel** gives the extractor sheet, a per-source sheet and a list of every error with the value when found, the value now, what the source says and who found it. The period defaults to all time.

**Read the scores with the sample in mind.** Final accuracy and catch rate are only as good as the fields you actually checked. A random spread gives an honest number. Checking only doubted fields makes accuracy look worse and catch rate look better than the truth.

---

## 5. Choosing kind and severity

**Kind of error**

| Kind | Use when |
|---|---|
| Wrong value | The source says something different |
| Missing value | The source has it, the record does not |
| Not in the source | The record has something the source never says |
| Format | Right value, wrong format |
| SOP rule | Breaks a rule in the SOP |
| Schema | Does not fit the schema (type, allowed values) |
| Duplicate | The same company appears twice |
| Something else | None of the above (say what in the note) |

**Severity**

- **Critical**: the record would mislead the client (wrong company, wrong country, wrong key product).
- **Major**: a real error in a field the client uses. This is the default.
- **Minor**: cosmetic or low impact (spacing, capitalisation).

---

## 6. Who sees what

| | Admin or QA lead | Peer reviewer | Extractor |
|---|---|---|---|
| Quality page (all tabs) | Yes | No | No |
| Source page "Quality check" card | Full | SOP, system and AI signals, plus their own logged errors | Same as reviewers |
| Other peers' comments | Yes | Only after they submit their own review | Yes, as review feedback |
| Ground-truth verdicts | Yes | No | No |
| Flag error on a record | Yes | Yes | No |
| Admin field comments | Write and remove own | See on the source page | See on the source page |
| Download of peer-reviewed sources | Yes | No | No |

---

## 7. Limits to remember

- The system cannot know what a source really says. Factual errors are found by people. Only your check at the source is ground truth.
- Peer mentions are matched by keyword. A vague note can be missed, and a field named in praise can be highlighted. Treat them as pointers.
- "Check on the site" uses the source's website and a web fetch. Blocked or login-walled pages come back empty. Check those by hand. Do not try to get past a login.
- The SOP check needs a saved SOP and looks only at the required-field list. It does not read the SOP's prose rules.
- Scores below 30 checked fields are low confidence.

---

## 8. Quick checklist

1. Peers have all submitted.
2. Run system checks.
3. SOP check: fix missing required fields first.
4. Review tab: project, source, riskiest record first.
5. Check on the site, then compare at the real source.
6. Mark doubted fields Correct or Wrong. Credit the peers who caught it.
7. Spot check random fields (30 or more in total).
8. Settle the open findings.
9. Read the scores.
10. Approve or send back.
