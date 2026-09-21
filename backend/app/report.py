"""Report Generator (PRD §4.3/§4.4): turns one process_email(...) result into
the frozen submission.json entry and the mutable `emails` DB row. Storage of
field_comparisons is opaque JSONB, so this stays decoupled from extractor.py/
evaluator.py shape changes landing in the Tier 2/3 worktrees."""
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def build_report(result: dict, run_id: str) -> tuple:
    """Returns (submission_entry, email_row) for one processed email."""
    comparison = result.get("comparison")
    # classify_email() can itself flag a processing failure (LLM response
    # didn't parse) at the top level, before any comparison is attempted —
    # that must count too, not just a failure inside the comparison step.
    processing_failure = result.get("processing_failure", False)

    if comparison is None:
        # comparison is None either because this category never goes
        # through document comparison (a genuine OK), or because
        # classify_email() itself failed (processing_failure=True) — those
        # two cases must not be reported the same way, or a real failure
        # silently looks like a clean OK in the graded submission.
        status = "NEEDS_REVIEW" if processing_failure else "OK"
        review_reason = None
        has_defect = False
        defect_fields = []
        trace_comparison = None
    else:
        status = comparison["status"]
        review_reason = comparison["review_reason"]
        has_defect = comparison["has_defect"]
        defect_fields = comparison["defect_fields"]
        processing_failure = processing_failure or comparison.get("processing_failure", False)
        trace_comparison = {
            "field_comparisons": comparison.get("field_comparisons", {}),
            "si_path": comparison.get("si_path"),
            "bl_path": comparison.get("bl_path"),
        }

    submission_entry = {
        "category": result["category"],
        "status": status,
        "review_reason": review_reason,
        "has_defect": has_defect,
        "defect_fields": defect_fields,
    }

    # `email_row` below is currently unused — the_coach.py (the only caller)
    # discards it (`_email_row`) and only persists `submission_entry`. Its
    # `email_id` is the bare id, unlike routes.py's own
    # `_process_and_save_worker`, which builds a run-scoped
    # f"{run_id}_{email_name}" id before writing to the emails table — if
    # this row is ever wired up to a real DB write, match that scheme
    # (and run review_reason through db.sanitize_review_reason()) first.
    email_row = {
        "email_id": result["email_id"],
        "category": result["category"],
        "automated_status": status,
        "automated_review_reason": review_reason,
        "current_status": status,
        "current_review_reason": review_reason,
        "has_defect": has_defect,
        "defect_fields": defect_fields,
        "awaiting_sender_response": False,
        "is_processing_failure": processing_failure,
        "run_id": run_id,
        "processed_at": now(),
        "trace": {
            "classification": {
                "category": result["category"],
                "confidence": result.get("confidence"),
                "reason": result.get("reason"),
            },
            "comparison": trace_comparison,
        },
    }

    return submission_entry, email_row
