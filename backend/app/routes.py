import sys
from pathlib import Path

# classifier.py / extractor.py / evaluator.py each do `from llm import ask_json`,
# expecting llm.py to be a top-level module. It actually lives in this same
# app/ folder, so make that folder importable as top-level before pulling
# those modules in. (Doesn't touch classifier.py/extractor.py/evaluator.py/llm.py.)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Blueprint, abort, jsonify, request

from loader import Inbox
from app.classifier import classify_email
from app.extractor import extract_field_pair
from app.evaluator import compare_documents
from app import db, report

bp = Blueprint("api", __name__, url_prefix="/api")

DOC_COMPARISON_CATEGORY = "BL_COMPARISON"
STATUS_VALUES = ("OK", "MISMATCH", "NEEDS_REVIEW")


def _attachment_role(att_path):
    """SI vs BL, from the filename convention (email_004_SI.txt / _BL.txt)."""
    name = att_path.rsplit("/", 1)[-1].upper()
    if "_SI" in name:
        return "SI"
    if "_BL" in name:
        return "BL"
    return None


def _missing_attachment_result(si_path, bl_path):
    """Same shape evaluator.compare_documents() returns, for the one case it
    can't handle itself: one of the two documents was never attached at all.
    Uses the PRD's exact 4-value review_reason enum (missing_attachment) —
    which side was missing is carried in si_path/bl_path, not the enum."""
    return {
        "status": "NEEDS_REVIEW",
        "review_reason": "missing_attachment",
        "processing_failure": False,
        "has_defect": False,
        "defect_fields": [],
        "field_comparisons": {},
        "si_path": si_path,
        "bl_path": bl_path,
    }


def _load_emails(inbox, limit=None, email_id=None):
    """inbox.emails() lists the whole inbox, then downloads every single
    email JSON from Storage one at a time — fine for a full batch run, way
    too slow for a limit-bounded smoke test. When limited, list filenames
    only (cheap) and download just the first N. email_id downloads just
    that one email, skipping the listing entirely."""
    if email_id is not None:
        return [inbox.get(email_id)]

    if limit is None:
        return inbox.emails()

    files = inbox._supabase_list("inbox")
    names = sorted(f["name"] for f in files if f["name"].startswith("email_"))[:limit]
    return [inbox.get(name[:-len(".json")]) for name in names]


def process_email(inbox, email):
    """Full pipeline for one email: classify, then — only for BL_COMPARISON
    emails — extract both documents' fields and evaluate them against
    each other."""
    classification = classify_email(email)

    if classification["category"] != DOC_COMPARISON_CATEGORY:
        return {**classification, "comparison": None}

    attachments = email.get("attachments", [])
    si_path = next((p for p in attachments if _attachment_role(p) == "SI"), None)
    bl_path = next((p for p in attachments if _attachment_role(p) == "BL"), None)

    if not si_path or not bl_path:
        comparison = _missing_attachment_result(si_path, bl_path)
    else:
        si_result, bl_result = extract_field_pair(inbox, si_path, bl_path)
        comparison = {**compare_documents(si_result, bl_result), "si_path": si_path, "bl_path": bl_path}

    return {**classification, "comparison": comparison}


@bp.errorhandler(404)
def _not_found(err):
    return jsonify(error=str(err.description or "not found")), 404


@bp.route("/hello")
def hello():
    return jsonify(message="Hello from Flask!")


@bp.route("/emails")
def list_emails():
    inbox = Inbox("supabase")
    return jsonify(inbox.emails())


@bp.route("/emails/<email_id>/process")
def process_single_email(email_id):
    inbox = Inbox("supabase")
    email = inbox.get(email_id)
    return jsonify(process_email(inbox, email))


@bp.route("/process")
def process_all_emails():
    """Runs the full pipeline over every email. Slow: one or more LLM calls
    per email, sequentially."""
    inbox = Inbox("supabase")
    results = [process_email(inbox, email) for email in inbox.emails()]
    return jsonify(results)


@bp.route("/runs", methods=["POST"])
def create_run():
    """Batch job (PRD §4.7/§4.10): processes the inbox synchronously,
    upserting each email's row (idempotent on rerun/crash-resume) and writing
    the frozen submission.json snapshot once at the end.

    Optional ?limit=N processes only the first N emails, or ?email_id=X
    processes just that one email — both for smoke-testing the pipeline/DB
    wiring cheaply. Either way the run still writes DB rows (so you can
    exercise the API), but deliberately skips submission.json: that file is
    the frozen, graded snapshot and must never be overwritten with a partial
    batch."""
    inbox = Inbox("supabase")
    run_id = db.create_run()

    limit = request.args.get("limit", type=int)
    email_id = request.args.get("email_id")
    emails = _load_emails(inbox, limit, email_id)

    submission = {}
    mismatch_count = 0
    needs_review_count = 0
    email_count = 0

    for email in emails:
        result = process_email(inbox, email)
        submission_entry, email_row = report.build_report(result, run_id)
        submission[result["email_id"]] = submission_entry
        db.upsert_email_row(email_row)

        email_count += 1
        if submission_entry["status"] == "MISMATCH":
            mismatch_count += 1
        elif submission_entry["status"] == "NEEDS_REVIEW":
            needs_review_count += 1

    db.finalize_run(run_id, email_count, mismatch_count, needs_review_count)

    submission_written = limit is None and email_id is None
    if submission_written:
        inbox.submit(submission)

    return jsonify(
        run_id=run_id,
        email_count=email_count,
        mismatch_count=mismatch_count,
        needs_review_count=needs_review_count,
        submission_written=submission_written,
    )


@bp.route("/runs")
def list_runs():
    return jsonify(db.list_runs())


@bp.route("/runs/<run_id>/emails")
def list_run_emails(run_id):
    return jsonify(db.list_run_emails(run_id))


@bp.route("/emails/<email_id>")
def get_email(email_id):
    row = db.get_email_row(email_id)
    if row is None:
        abort(404, description=f"no processed email {email_id}")

    inbox = Inbox("supabase")
    email = inbox.get(email_id)

    return jsonify({
        **row,
        "sender": email.get("from"),
        "subject": email.get("subject"),
        "body": email.get("body"),
    })


@bp.route("/emails/<email_id>/source")
def get_email_source(email_id):
    row = db.get_email_row(email_id)
    if row is None:
        abort(404, description=f"no processed email {email_id}")

    inbox = Inbox("supabase")
    comparison = (row.get("trace") or {}).get("comparison") or {}

    def _read(path):
        if not path:
            return {"path": None, "text": "unreadable"}
        try:
            return {"path": path, "text": inbox.read_text(path)}
        except Exception:
            return {"path": path, "text": "unreadable"}

    return jsonify(si=_read(comparison.get("si_path")), bl=_read(comparison.get("bl_path")))


@bp.route("/emails/<email_id>/resolve", methods=["POST"])
def resolve_email(email_id):
    row = db.get_email_row(email_id)
    if row is None:
        abort(404, description=f"no processed email {email_id}")

    body = request.get_json(silent=True) or {}
    decision = body.get("decision")
    awaiting = bool(body.get("awaiting_sender_response"))
    notes = body.get("notes")

    if decision and awaiting:
        abort(400, description="decision and awaiting_sender_response are mutually exclusive")
    if not decision and not awaiting:
        abort(400, description="must provide either decision or awaiting_sender_response")
    if decision and decision not in STATUS_VALUES:
        abort(400, description=f"decision must be one of {STATUS_VALUES}")

    defect_fields = body.get("defect_fields", row.get("defect_fields", []))

    if decision:
        update_fields = {
            "current_status": decision,
            "current_review_reason": None if decision != "NEEDS_REVIEW" else row.get("current_review_reason"),
            "has_defect": decision == "MISMATCH",
            "defect_fields": defect_fields if decision == "MISMATCH" else [],
            "awaiting_sender_response": False,
        }
        action = "resolved"
    else:
        update_fields = {"awaiting_sender_response": True}
        action = "awaiting_sender_response"

    db.update_email_resolution(email_id, **update_fields)
    db.insert_audit_log_row({
        "email_id": email_id,
        "run_id": row.get("run_id"),
        "escalated_at": row.get("processed_at"),
        "review_reason": row.get("automated_review_reason"),
        "automated_result": row.get("automated_status"),
        "action": action,
        "resolved_at": report.now(),
        "resolved_by": body.get("resolved_by", "reviewer"),
        "human_decision": decision,
        "defect_fields": defect_fields if decision == "MISMATCH" else [],
        "notes": notes,
    })

    return jsonify(db.get_email_row(email_id))
