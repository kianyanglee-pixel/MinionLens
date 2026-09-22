"""the_coach.py — the_invigilator.py's sibling for open-ended smoke runs.

Run: `python the_coach.py` (no arguments, whole inbox) or
`python the_coach.py N` (an optional email cap). Processes up to N emails
(or the whole inbox) from the Supabase inbox concurrently — same
max_workers=3 pool size as the real app's stream_batch_process()
(routes.py) — through the same pipeline (classify_email -> extract/compare
for BL_COMPARISON emails -> report.build_report()). process_email() itself
(routes.py) already catches a pipeline-level failure (an LLM call that
exhausted its retries, an extraction exception) and reports it as
is_processing_failure rather than raising, so one email failing doesn't
stop the run — every requested email gets a real attempt, same as a
production batch run.

The resulting submission is uploaded to Supabase as
submissions/submission_coach_{x}.json — same bucket/folder as the real,
frozen submission.json, just a different filename per run, so it can
never overwrite that file or a previous coach run (x auto-increments;
nothing is ever overwritten, so runs accumulate as history).

It is then graded against ground_truth.json restricted to just the N
email_ids actually processed — a partial run isn't penalized as "low
coverage" for emails it was never asked to touch. All the actual grading
math (accuracy/F1/confusion matrices/Cohen's kappa/Jaccard) is reused
unmodified from the_invigilator.py.

Writes one combined Excel report card to
stats_bundle/report_card/performance_coach_{x}.xlsx and a graph to
stats_bundle/summary_graphs/graph_coach_{x}.png (same x for both, and for
the uploaded submission_coach_{x}.json).
"""
import itertools
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

STATS_BUNDLE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = STATS_BUNDLE_DIR.parent / "backend"
REPORT_CARD_DIR = STATS_BUNDLE_DIR / "report_card"
SUMMARY_GRAPHS_DIR = STATS_BUNDLE_DIR / "summary_graphs"
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

from loader import Inbox  # noqa: E402
from app.report import build_report  # noqa: E402
from app.routes import process_email  # noqa: E402
from app import db  # noqa: E402
from app.classifier import classify_email  # noqa: E402
from app.evaluator import compare_documents  # noqa: E402
from app.extractor import extract_field_pair, extract_fields  # noqa: E402
from app.llm import ask_json, client, DEFAULT_MODEL  # noqa: E402
from app.unit_normalizer import to_kg  # noqa: E402

from the_invigilator import (  # noqa: E402
    _load_ground_truth,
    _pct,
    evaluate,
    render_xlsx,
    render_graphs,
)


def _detect_llm_provider() -> str:
    """Figures out which of llm.py's provider blocks is currently active by
    inspecting the `client` object it constructed — llm.py only ever
    uncomments one block at a time, so this stays accurate without llm.py
    needing to declare its own provider name anywhere."""
    module_name = type(client).__module__

    if "genai" in module_name:
        return "Google Gemini (direct)"

    base_url = str(getattr(client, "base_url", ""))
    if "openrouter.ai" in base_url:
        return "OpenRouter"
    if "localhost:11434" in base_url or "ollama" in base_url:
        return "Ollama (local)"
    if "api.openai.com" in base_url:
        return "OpenAI (direct)"
    return f"Unknown provider (client={module_name}, base_url={base_url or 'n/a'})"


def _llm_info_line() -> str:
    return f"{_detect_llm_provider()} — model: {DEFAULT_MODEL}"


def _next_index(inbox: Inbox) -> int:
    """Shared counter for performance_coach_{x}.xlsx, graph_coach_{x}.png,
    and submission_coach_{x}.json, so a run's three outputs always carry
    the same x. Own counter, independent of the_invigilator.py's."""
    REPORT_CARD_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_GRAPHS_DIR.mkdir(parents=True, exist_ok=True)
    existing_remote = {f["name"] for f in inbox._supabase_list("submissions")}

    x = 1
    while (
        (REPORT_CARD_DIR / f"performance_coach_{x}.xlsx").exists()
        or (SUMMARY_GRAPHS_DIR / f"graph_coach_{x}.png").exists()
        or f"submission_coach_{x}.json" in existing_remote
    ):
        x += 1
    return x


def _process_one(inbox: Inbox, email: dict, run_id: str):
    """One email's full pipeline run, for use inside the worker pool.
    process_email() (routes.py) already turns a pipeline-level failure into
    an is_processing_failure result rather than raising, so the try/except
    here is only a last-resort net for a genuinely unexpected bug — it
    reports and skips that one email rather than aborting the whole run."""
    try:
        result = process_email(inbox, email)
    except Exception as exc:
        print(f"[!] Unexpected error on {email.get('email_id')}: {type(exc).__name__}: {exc}")
        return None
    submission_entry, _email_row = build_report(result, run_id)
    return result["email_id"], submission_entry


def _run_parallel(inbox: Inbox, run_id: str, limit: int = None, max_workers: int = 3) -> dict:
    """Processes up to `limit` emails (or the whole inbox) concurrently —
    max_workers=3 matches the real app's stream_batch_process() (routes.py)
    pool size, kept conservative since each worker holds an LLM call in
    flight against local Ollama (memory-bound, not just CPU/socket-bound —
    see routes.py's comment on the same pool size). Returns the submission
    dict built from every email that produced a result (a per-email failure
    just means that email is missing from the returned dict, not that the
    run stops)."""
    emails = inbox.emails()
    if limit is not None:
        emails = list(itertools.islice(emails, limit))
    total = len(emails)

    submission = {}
    completed = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_process_one, inbox, email, run_id) for email in emails]
        for future in as_completed(futures):
            completed += 1
            outcome = future.result()
            if outcome is not None:
                email_id, submission_entry = outcome
                submission[email_id] = submission_entry
            print(f"[{completed}/{total}] processed ({len(submission)} succeeded so far)")

    return submission


def main():
    limit = None
    if len(sys.argv) > 1:
        try:
            limit = int(sys.argv[1])
        except ValueError:
            print(f"Ignoring invalid argument {sys.argv[1]!r} — expected an integer N or no argument.")

    print(f"Active LLM: {_llm_info_line()}")
    inbox = Inbox("supabase")
    x = _next_index(inbox)

    submission = _run_parallel(inbox, run_id=f"coach_{x}", limit=limit)
    if not submission:
        print("No emails were successfully processed — nothing to submit or grade.")
        return

    filename = f"submission_coach_{x}.json"
    inbox.submit(submission, filename=filename)
    print(f"Uploaded submissions/{filename} ({len(submission)} email(s))")

    ground_truth_full = _load_ground_truth()
    ground_truth_subset = {eid: ground_truth_full[eid] for eid in submission if eid in ground_truth_full}

    report = evaluate(ground_truth_subset, submission)

    report_path = REPORT_CARD_DIR / f"performance_coach_{x}.xlsx"
    graph_path = SUMMARY_GRAPHS_DIR / f"graph_coach_{x}.png"

    requested = f"a requested {limit}" if limit is not None else "the whole inbox"
    extra_summary_rows = [
        ("Coach run", f"N={len(submission)} email(s) succeeded (of {requested})"),
        ("Graded against", f"{len(submission)} of {len(ground_truth_full)} in the answer key "
                            "(coverage below reads against this subset, not the full key)"),
    ]
    render_xlsx(report, report_path,
                title="THE COACH — Pipeline Report Card", extra_summary_rows=extra_summary_rows)
    render_graphs(report, graph_path)

    print(f"Wrote {report_path}")
    print(f"Wrote {graph_path}")
    print(f"  evaluated {report['evaluated_count']}/{len(ground_truth_subset)} email(s) "
          f"(of {len(ground_truth_full)} total in the answer key)")
    print(f"  category accuracy:  {_pct(report['category']['accuracy'])}")
    print(f"  status accuracy:    {_pct(report['status']['accuracy'])}")
    print(f"  row exact match:    {_pct(report['rollups']['row_exact_match_rate'])}")


if __name__ == "__main__":
    main()
