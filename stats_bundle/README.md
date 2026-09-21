# stats_bundle — evaluation tooling

Grades the pipeline's output against `ground_truth.json`, using plain
deterministic code for every metric — no AI involved in the grading itself.
The one deliberate exception is a final AI-generated "what to improve next"
section, clearly labeled as advice to review, not a graded metric.

- **`the_coach.py [N]`** — runs N real emails (or the whole inbox, if no N
  given) through the actual pipeline against live Supabase, then grades
  whatever it processed. Use this to check accuracy while iterating.
  ```bash
  python the_coach.py 10
  ```
- **`the_invigilator.py`** — grades whatever `submission.json` is already
  sitting in Supabase storage (the full, frozen batch run), without
  re-processing anything.

Both write two things per run, X auto-incrementing so nothing is ever
overwritten:
- `report_card/performance_{X}.xlsx` (or `performance_coach_{X}.xlsx`) — one
  workbook: accuracy/precision/recall/F1 and a confusion matrix per graded
  field (category, status, review_reason, has_defect, defect_fields), an
  overall summary, every mistake grouped by field, and AI-generated
  suggestions for prompt/logic changes.
- `summary_graphs/graphs_{X}.jpg` (or `graph_coach_{X}.png`) — the same
  results as a one-image dashboard (accuracy bar chart, confusion-matrix
  heatmaps, per-label F1, headline numbers).

These are real run history, not scratch files — each numbered pair is
evidence from an actual evaluation against real data, kept rather than
overwritten.
