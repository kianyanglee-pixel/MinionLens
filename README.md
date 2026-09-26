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
cp .env.example .env   # set SUPABASE_URL / SUPABASE_KEY
python run.py          # serves http://localhost:5000, routes under /api
```

The backend connects directly to Supabase using `SUPABASE_URL` and
`SUPABASE_KEY` in `backend/.env`. Keep the key on the backend; do not put it
in frontend environment variables. Use the project's server-side key with
the permissions needed to read Storage and write the `runs`, `emails`, and
`review_audit_log` tables.

The LLM provider is selected with `LLM_PROVIDER` in `backend/.env`. Gemini is
the default. To use local Ollama, set `LLM_PROVIDER=ollama`, install
[Ollama](https://ollama.com/download), and run:

```bash
ollama pull qwen2.5:7b
```

The default Ollama endpoint is `http://localhost:11434/v1`; set
`OLLAMA_BASE_URL` or `OLLAMA_MODEL` if yours differs. Restart the backend
after changing `.env`. The upload screen will not ask for an API key when
Ollama is selected. OpenAI and OpenRouter are also supported through the same
provider setting.

With the `local` source selected, the browser uploads the batch to the local
Flask backend, which processes it and writes run/email/review results to the
configured Supabase project. The original sender, subject, body, and
attachment names are saved in each email row's `trace` JSON, so the original
email drawer can show them from another browser/device without reopening the
source inbox. The `database` source instead reads inbox and attachment files
already in the configured Supabase Storage bucket.

For a second device on the same trusted network, start Vite with
`npm run dev -- --host 0.0.0.0` and open the computer's LAN address on port
5173. The backend already binds to all local interfaces. This app currently
has no user authentication, so do not expose either development server to the
public internet; use an authenticated deployment for access outside your LAN.

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
