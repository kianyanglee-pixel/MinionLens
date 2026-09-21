"""the_coach.py — the_invigilator.py's sibling for open-ended smoke runs.

Run: `python the_coach.py` (no arguments). Processes emails from the
Supabase inbox one at a time, in the same order and through the same
pipeline routes.py's create_run() uses (classify_email -> extract/compare
for BL_COMPARISON emails -> report.build_report()), and simply keeps going
until either the inbox runs out or a call raises (Ollama/API quota or
rate-limit exhausted, after llm.py's own retries) — whichever comes first.
Whatever was successfully processed before that is this run's N.

The resulting submission is uploaded to Supabase as
submissions/submission_coach_{x}.json — same bucket/folder as the real,
frozen submission.json, just a different filename per run, so it can
never overwrite that file or a previous coach run (x auto-increments;
nothing is ever overwritten, so runs accumulate as history).

It is then graded against ground_truth.json restricted to just the N
email_ids actually processed — a partial run isn't penalized as "low
coverage" for emails it was never asked to touch. All the actual grading
math (accuracy/F1/confusion matrices/Cohen's kappa/Jaccard) and the one
AI-recommendations LLM call are reused unmodified from the_invigilator.py.

Writes stats_bundle/report_card/performance_coach_{x}.txt and
stats_bundle/summary_graphs/graph_coach_{x}.png (same x for both, and for
the uploaded submission_coach_{x}.json).
"""
import sys
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

from the_invigilator import (  # noqa: E402
    _llm_info_line,
    _load_ground_truth,
    _pct,
    evaluate,
    get_ai_recommendations,
    render_graphs,
    render_text,
)


def _next_index(inbox: Inbox) -> int:
    """Shared counter for performance_coach_{x}.txt, graph_coach_{x}.png,
    and submission_coach_{x}.json, so a run's three outputs always carry
    the same x. Own counter, independent of the_invigilator.py's."""
    REPORT_CARD_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_GRAPHS_DIR.mkdir(parents=True, exist_ok=True)
    existing_remote = {f["name"] for f in inbox._supabase_list("submissions")}

    x = 1
    while (
        (REPORT_CARD_DIR / f"performance_coach_{x}.txt").exists()
        or (SUMMARY_GRAPHS_DIR / f"graph_coach_{x}.png").exists()
        or f"submission_coach_{x}.json" in existing_remote
    ):
        x += 1
    return x


def _run_until_stopped(inbox: Inbox, run_id: str) -> dict:
    """Processes emails one at a time, in inbox order, until either the
    inbox is exhausted or process_email() raises (typically an LLM
    quota/rate-limit error surfacing after llm.py's own retries are spent).
    Returns the submission dict built from whatever succeeded."""
    submission = {}
    for email in inbox.emails():
        try:
            result = process_email(inbox, email)
        except Exception as exc:
            print(f"Stopped after {len(submission)} email(s) — {type(exc).__name__}: {exc}")
            break
        submission_entry, _email_row = build_report(result, run_id)
        submission[result["email_id"]] = submission_entry
    else:
        print(f"Processed the full inbox ({len(submission)} email(s)) without hitting an error.")
    return submission


def main():
    print(f"Active LLM: {_llm_info_line()}")
    inbox = Inbox("supabase")
    x = _next_index(inbox)

    submission = _run_until_stopped(inbox, run_id=f"coach_{x}")
    if not submission:
        print("No emails were successfully processed — nothing to submit or grade.")
        return

    filename = f"submission_coach_{x}.json"
    inbox.submit(submission, filename=filename)
    print(f"Uploaded submissions/{filename} ({len(submission)} email(s))")

    ground_truth_full = _load_ground_truth()
    ground_truth_subset = {eid: ground_truth_full[eid] for eid in submission if eid in ground_truth_full}

    report = evaluate(ground_truth_subset, submission)
    recommendations = get_ai_recommendations(report, inbox)

    report_path = REPORT_CARD_DIR / f"performance_coach_{x}.txt"
    graph_path = SUMMARY_GRAPHS_DIR / f"graph_coach_{x}.png"

    header = (
        f"COACH RUN — N={len(submission)} email(s) processed before stopping "
        "(inbox exhausted or an API/quota error was hit)\n"
        f"Graded against only these {len(submission)} email(s) out of the "
        f"{len(ground_truth_full)}-email answer key, so coverage below reads "
        "against that subset, not the full key.\n"
    )
    report_path.write_text(header + "\n" + render_text(report, recommendations), encoding="utf-8")
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
