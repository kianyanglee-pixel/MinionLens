# MinionLens

An AI-assisted pipeline for a shipping-ops inbox: it classifies incoming
emails, and for a document-check request, extracts 7 key fields from a
**Shipping Instruction (SI)** and a draft **Bill of Lading (BL)**, compares
them, and reports exactly what matches, what doesn't, and what it isn't sure
about — escalating uncertain cases to a human instead of guessing.

Full product/architecture rationale (why each step is or isn't an LLM call,
the guardrail decisions, the data model, the API contract) lives in
[`PRD.md`](PRD.md). This file is just "how do I run it."

## How it works, in short

```
Inbox email --> Classifier (LLM) --> BL_COMPARISON? --> Field Extractor (LLM)
                                            |                    |
                                      other categories    Literal Match Check (code)
                                            |                    |
                                       Tag + report      Grounding Verifier (LLM, only
                                                          for what the check couldn't
                                                          resolve)
                                                                 |
                                                          Comparator (code, deterministic
                                                          7-field diff, weight-tolerant)
                                                                 |
                                               OK / MISMATCH / NEEDS_REVIEW
                                                                 |
                                        Report Generator --> submission.json (frozen)
                                                          --> Supabase (live dashboard state)
```

Only the two steps that genuinely need judgment (reading messy language,
matching documents by meaning) go through an LLM. Routing, the field diff,
and the trust/escalation decision are all plain, deterministic code — see
`PRD.md` §2.4 for why.

## Project layout

- `backend/` — Flask API (`app/routes.py`) + the pipeline modules
  (`classifier.py`, `extractor.py`, `evaluator.py`, `unit_normalizer.py`,
  `llm.py`, `db.py`), plus `migrations/` for the Supabase/Postgres schema.
- `frontend/` — React + Vite + Tailwind dashboard (run history, email
  queue, field-by-field comparison, human review).
- `stats_bundle/` — evaluation tooling, independent of the running app:
  grades a submission against `ground_truth.json` and writes a scored
  report card (accuracy/F1/confusion matrices per field, plus AI-generated
  improvement suggestions). See [`stats_bundle/README.md`](stats_bundle/README.md).

## Running it locally

**Backend**
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_KEY at minimum
python run.py          # serves http://localhost:5000, routes under /api
```

The active LLM provider is picked in `backend/app/llm.py` — see the comment
block at the top of that file. It defaults to **Google Gemini** (direct,
`gemini-3.6-flash`): a cloud API anyone on the team can use with just a
`GEMINI_API_KEY` in `.env`, no local install needed. For free, local,
no-API-key iteration instead, uncomment the Ollama block: install
[Ollama](https://ollama.com/download), then `ollama pull qwen2.5:7b` before
running the backend. OpenRouter/OpenAI are each a one-block swap away too.

**Frontend**
```bash
cd frontend
npm install
npm run dev             # serves http://localhost:5173, proxies /api to :5000
```

## Evaluating pipeline accuracy

- `stats_bundle/the_coach.py [N]` **runs** N emails (or the whole inbox)
  through the real pipeline against live Supabase data, then grades the
  result — no mocking, this is the same code path the app itself uses.
- `stats_bundle/the_invigilator.py` doesn't run anything itself — it grades
  whatever `submission.json` is already sitting in Supabase storage, i.e.
  the full, frozen batch submission produced by a real run (via the app's
  `/api/ingest` + `/api/stream-process`, or a whole-inbox `the_coach.py`
  run). Use this to grade the actual submission you're about to hand in.

See [`stats_bundle/README.md`](stats_bundle/README.md) for what each one
produces.
