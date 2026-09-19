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

    if comparison is None:
        status = None
        review_reason = None
        has_defect = False
        defect_fields = []
        processing_failure = False
        trace_comparison = None
    else:
        status = comparison["status"]
        review_reason = comparison["review_reason"]
        has_defect = comparison["has_defect"]
        defect_fields = comparison["defect_fields"]
        processing_failure = comparison.get("processing_failure", False)
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
