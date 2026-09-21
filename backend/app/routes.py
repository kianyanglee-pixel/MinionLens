import sys
from pathlib import Path
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Blueprint, jsonify, request, Response, stream_with_context

from loader import Inbox
from app.classifier import classify_email
from app.extractor import extract_fields
from app.evaluator import compare_documents
from app.ingest import (
    BASE_DATA_DIR,
    get_batch_dirs,
    save_uploaded_files_for_batch,
    sync_from_s3,
    sync_from_gcs,
    sync_from_gdrive_folder
)
from app.db import (
    get_supabase,
    init_run_record,
    sanitize_review_reason,
    save_single_processed_email,
    finalize_run_record,
    get_pending_review_queue,
    resolve_review_item
)

bp = Blueprint("api", __name__, url_prefix="/api")

DOC_COMPARISON_CATEGORY = "BL_COMPARISON"

def _attachment_role(att_path):
    name = att_path.rsplit("/", 1)[-1].upper()
    if "_SI" in name:
        return "SI"
    if "_BL" in name:
        return "BL"
    return None

def _missing_attachment_result(missing_role):
    return {
        "status": "NEEDS_REVIEW",
        "review_reason": f"missing_{missing_role.lower()}_attachment",
        "has_defect": False,
        "defect_fields": [],
        "field_comparisons": {},
    }

def process_email(inbox, email):
    classification = classify_email(email)
    category = classification.get("category", "GENERAL")

    if category != DOC_COMPARISON_CATEGORY:
        return {
            "email_id": email.get("email_id"),
            "category": category,
            "classification": classification,
            "comparison": None
        }

    attachments = email.get("attachments", [])
    si_path = next((p for p in attachments if _attachment_role(p) == "SI"), None)
    bl_path = next((p for p in attachments if _attachment_role(p) == "BL"), None)

    if not si_path or not bl_path:
        comparison = _missing_attachment_result("SI" if not si_path else "BL")
        comparison["si_path"] = si_path
        comparison["bl_path"] = bl_path
    else:
        si_result = extract_fields(inbox, si_path)
        bl_result = extract_fields(inbox, bl_path)
        comparison = compare_documents(si_result, bl_result)
        comparison["si_path"] = si_path
        comparison["bl_path"] = bl_path

    return {
        "email_id": email.get("email_id"),
        "category": category,
        "classification": classification,
        "comparison": comparison
    }

def _process_and_save_worker(inbox, email_data, run_id: str):
    """Worker task executed concurrently for each email."""
    email_id = str(email_data.get("email_id"))
    email_name = f"{email_id}.json"

    result = process_email(inbox, email_data)
    category = result.get("category", "GENERAL")
    classification = result.get("classification", {})
    comparison = result.get("comparison")

    is_spam = category == "SPAM"
    is_mismatch = False
    is_needs_review = False
    is_clear = False

    if comparison is not None:
        automated_status = comparison.get("status", "OK")
        raw_review = comparison.get("review_reason")
        automated_review = sanitize_review_reason(raw_review)
        has_defect = comparison.get("has_defect", False)
        defect_fields = comparison.get("defect_fields", [])

        if automated_status == "MISMATCH":
            is_mismatch = True
        elif automated_status == "NEEDS_REVIEW":
            is_needs_review = True
        elif automated_status == "OK":
            is_clear = True

        trace_payload = {
            "comparison": {
                "bl_path": comparison.get("bl_path"),
                "si_path": comparison.get("si_path"),
                "field_comparisons": comparison.get("field_comparisons", {})
            },
            "classification": {
                "reason": classification.get("reason"),
                "category": category,
                "confidence": classification.get("confidence")
            }
        }
    else:
        automated_status = "OK"
        automated_review = None
        has_defect = False
        defect_fields = []
        trace_payload = {
            "comparison": None,
            "classification": {
                "reason": classification.get("reason"),
                "category": category,
                "confidence": classification.get("confidence")
            }
        }

    now = datetime.now(timezone.utc).isoformat()

    email_row = {
        "email_id": email_id,
        "email_name": email_name,
        "category": category,
        "automated_status": automated_status,
        "automated_review_reason": automated_review,
        "current_status": automated_status,
        "current_review_reason": automated_review,
        "has_defect": has_defect,
        "defect_fields": defect_fields,
        "awaiting_sender_response": False,
        "is_processing_failure": False,
        "run_id": run_id,
        "processed_at": now,
        "trace": trace_payload
    }

    audit_row = None
    if has_defect or automated_status == "NEEDS_REVIEW":
        audit_row = {
            "email_id": email_id,
            "escalated_at": now,
            "review_reason": automated_review or "Document discrepancy detected",
            "automated_result": automated_status,
            "action": "ESCALATED",
            "defect_fields": defect_fields,
        }

    # Save immediately to Supabase
    save_single_processed_email(email_row, audit_row)

    return {
        "email_id": email_id,
        "status": automated_status,
        "is_mismatch": is_mismatch,
        "is_needs_review": is_needs_review,
        "is_clear": is_clear,
        "is_spam": is_spam
    }

# ==========================================
# Ingestion Route (Batch-Isolated Folders)
# ==========================================
@bp.route("/ingest", methods=["POST"])
def ingest_batch():
    started_at = (
        request.form.get("started_at") 
        or (request.get_json() or {}).get("started_at") 
        or datetime.now(timezone.utc).isoformat()
    )

    if "inbox_files" in request.files or "attachment_files" in request.files:
        inbox_files = request.files.getlist("inbox_files")
        attachment_files = request.files.getlist("attachment_files")

        run_id = init_run_record(started_at=started_at, email_count=len(inbox_files))
        in_count, att_count = save_uploaded_files_for_batch(run_id, inbox_files, attachment_files)

        return jsonify({
            "status": "success",
            "run_id": run_id,
            "inbox_count": in_count,
            "attachment_count": att_count,
            "started_at": started_at
        })

    data = request.get_json() or {}
    source_type = data.get("source_type")
    inbox_uri = data.get("inbox_uri", "")
    attachments_uri = data.get("attachments_uri", "")

    run_id = init_run_record(started_at=started_at, email_count=0)
    batch_root, inbox_dir, attachments_dir = get_batch_dirs(run_id)

    try:
        if source_type == "cloud":
            if inbox_uri.startswith("s3://"):
                in_count = sync_from_s3(inbox_uri, inbox_dir)
                att_count = sync_from_s3(attachments_uri, attachments_dir)
            elif inbox_uri.startswith("gs://"):
                in_count = sync_from_gcs(inbox_uri, inbox_dir)
                att_count = sync_from_gcs(attachments_uri, attachments_dir)
        elif source_type == "drive":
            in_count = sync_from_gdrive_folder(inbox_uri, inbox_dir)
            att_count = sync_from_gdrive_folder(attachments_uri, attachments_dir)
        else:
            return jsonify({"status": "error", "message": "Unknown source_type"}), 400

        get_supabase().table("runs").update({"email_count": in_count}).eq("run_id", run_id).execute()

        return jsonify({
            "status": "success",
            "run_id": run_id,
            "inbox_count": in_count,
            "attachment_count": att_count,
            "started_at": started_at
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# ==========================================
# Parallel Streaming Verification Route
# ==========================================
@bp.route("/stream-process", methods=["GET"])
def stream_batch_process():
    run_id = request.args.get("run_id")
    if not run_id:
        return {"status": "error", "message": "run_id is required"}, 400

    batch_path = (BASE_DATA_DIR / run_id).resolve()

    def generate_events():
        inbox = Inbox(batch_path)
        emails = inbox.emails()
        total_emails = len(emails)

        yield f"data: {json.dumps({'stage': 'INIT', 'message': f'Starting parallel verification for {total_emails} emails...', 'current': 0, 'total': total_emails})}\n\n"

        counts = {
            "mismatch_count": 0,
            "needs_review_count": 0,
            "clear_count": 0,
            "spam_count": 0
        }
        completed_count = 0

        # Concurrent Thread Pool (6 concurrent workers)
        with ThreadPoolExecutor(max_workers=6) as executor:
            futures = {
                executor.submit(_process_and_save_worker, inbox, email, run_id): email
                for email in emails
            }

            for future in as_completed(futures):
                completed_count += 1
                try:
                    res = future.result()
                    if res["is_mismatch"]: counts["mismatch_count"] += 1
                    if res["is_needs_review"]: counts["needs_review_count"] += 1
                    if res["is_clear"]: counts["clear_count"] += 1
                    if res["is_spam"]: counts["spam_count"] += 1

                    msg = f"[{completed_count}/{total_emails}] Verified {res['email_id']} -> {res['status']}"
                except Exception as err:
                    msg = f"[{completed_count}/{total_emails}] Failed email: {str(err)[:60]}"

                yield f"data: {json.dumps({'stage': 'PROCESSING', 'message': msg, 'current': completed_count, 'total': total_emails})}\n\n"

        finalize_run_record(run_id, counts)
        yield f"data: {json.dumps({'stage': 'DONE', 'message': f'Batch complete! Processed {total_emails} emails.', 'current': total_emails, 'total': total_emails})}\n\n"

    return Response(
        stream_with_context(generate_events()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )

# ==========================================
# Run Details and Resolution Endpoints
# ==========================================
@bp.route("/runs", methods=["GET"])
def list_all_runs():
    supabase = get_supabase()
    runs_res = supabase.table("runs").select("*").order("started_at", desc=True).execute()
    return jsonify({"status": "success", "runs": runs_res.data or []})

@bp.route("/runs/latest", methods=["GET"])
def get_latest_run():
    supabase = get_supabase()
    run_res = supabase.table("runs").select("*").order("started_at", desc=True).limit(1).execute()
    if not run_res.data:
        return jsonify({"status": "error", "message": "No runs found"}), 404

    run = run_res.data[0]
    emails_res = supabase.table("emails").select("*, review_audit_log(*)").eq("run_id", run["run_id"]).order("processed_at", desc=False).execute()
    return jsonify({"status": "success", "run": run, "emails": emails_res.data or []})

@bp.route("/runs/<run_id>", methods=["GET"])
def get_run_details(run_id):
    supabase = get_supabase()
    run_res = supabase.table("runs").select("*").eq("run_id", run_id).single().execute()
    if not run_res.data:
        return jsonify({"status": "error", "message": "Run not found"}), 404

    emails_res = supabase.table("emails").select("*, review_audit_log(*)").eq("run_id", run_id).order("processed_at", desc=False).execute()
    return jsonify({"status": "success", "run": run_res.data, "emails": emails_res.data or []})

@bp.route("/reviews", methods=["GET"])
def get_reviews():
    try:
        data = get_pending_review_queue()
        return jsonify({"status": "success", "items": data})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@bp.route("/reviews/<email_id>/resolve", methods=["POST"])
def resolve_email_review(email_id):
    body = request.get_json() or {}
    decision = body.get("decision", "APPROVED")
    resolved_by = body.get("resolved_by", "Operator")
    notes = body.get("notes", "")

    try:
        result = resolve_review_item(email_id=email_id, decision=decision, resolved_by=resolved_by, notes=notes)
        return jsonify(result)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500