#  FINAL COMPLETE PACKAGE
====================================

## PART 1 — Gemini API Migration (push to git)
Files in: backend/backend_gemini/
  config.py        → replace backend/app/core/config.py
  sources.py       → replace backend/app/api/v1/routes/sources.py
  requirements.txt → replace backend/requirements.txt

Then in Railway → backend service → Variables:
  ADD:    GEMINI_API_KEY = <your key from Google AI Studio>
  REMOVE: ANTHROPIC_API_KEY

Git commands:
  git add backend/app/core/config.py backend/app/api/v1/routes/sources.py backend/requirements.txt
  git commit -m "Migrate: Anthropic Claude → Google Gemini API"
  git push

## PART 2 — WebTailBench Seeding
Files in: webtailbench/

Run:
  cd webtailbench/
  C:/Python314/python.exe setup_final_v2.py

This will:
  1. Clean up old WebTailBench projects
  2. Create project + schema
  3. Create 11 sources (one per benchmark category)
  4. Upload all 609 pre-filled records

## WebTailBench Record Structure
Each record has 19 fields in 3 sections:
  A. Reference (pre-filled)    : task_id, benchmark, task_summary, criteria, 
                                  num_criteria, total_max_points, is_annotated,
                                  has_reference_answer, reference_answer, video_link
  B. Extractor fills            : extracted_answer, urls_visited, primary_url,
                                  data_extracted, extraction_notes, extraction_complete
  C. Reviewer fills             : score_achieved, score_breakdown, reviewer_notes
