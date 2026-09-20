import sys
from pathlib import Path

# classifier.py / extractor.py / evaluator.py each do `from llm import ask_json`,
# expecting llm.py to be a top-level module. It actually lives in this same
# app/ folder, so make that folder importable as top-level before pulling
# those modules in. (Doesn't touch classifier.py/extractor.py/evaluator.py/llm.py.)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Blueprint, jsonify, request

from loader import Inbox
from app.classifier import classify_email
from app.extractor import extract_fields
from app.evaluator import compare_documents
from app.ingest import(
    INBOX_DIR,
    ATTACHMENTS_DIR,
    sync_from_s3,
    sync_from_gcs,
    sync_from_gdrive_folder,
    save_uploaded_files
)

bp = Blueprint("api", __name__, url_prefix="/api")

DOC_COMPARISON_CATEGORY = "BL_COMPARISON"


def _attachment_role(att_path):
    """SI vs BL, from the filename convention (email_004_SI.txt / _BL.txt)."""
    name = att_path.rsplit("/", 1)[-1].upper()
    if "_SI" in name:
        return "SI"
    if "_BL" in name:
        return "BL"
    return None


def _missing_attachment_result(missing_role):
    """Same shape evaluator.compare_documents() returns, for the one case it
    can't handle itself: one of the two documents was never attached at all."""
    return {
        "status": "NEEDS_REVIEW",
        "review_reason": f"missing_{missing_role.lower()}_attachment",
        "has_defect": False,
        "defect_fields": [],
        "field_comparisons": {},
    }


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
        comparison = _missing_attachment_result("SI" if not si_path else "BL")
    else:
        si_result = extract_fields(inbox, si_path)
        bl_result = extract_fields(inbox, bl_path)
        comparison = compare_documents(si_result, bl_result)

    return {**classification, "comparison": comparison}


@bp.route("/hello")
def hello():
    return jsonify(message="Hello from Flask!")


@bp.route("/emails")
def list_emails():
    inbox = Inbox("supabase")
    return jsonify(inbox.emails())


@bp.route("/emails/<email_id>")
def get_email(email_id):
    inbox = Inbox("supabase")
    return jsonify(inbox.get(email_id))


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

@bp.route("/ingest", methods=["POST"])
def ingest_batch():
    # A) Multi-part Form Data (Local Folder Upload)
    if "inbox_files" in request.files or "attachment_files" in request.files:
        inbox_files = request.files.getlist("inbox_files")
        attachment_files = request.files.getlist("attachment_files")
        
        in_count, att_count = save_uploaded_files(inbox_files, attachment_files)
        return jsonify({
            "status": "success",
            "message": f"Local files saved: {in_count} inbox emails, {att_count} attachments.",
            "inbox_count": in_count,
            "attachment_count": att_count
        })

    # B) JSON Body (S3 / GCS / Google Drive)
    data = request.get_json() or {}
    source_type = data.get("source_type")
    inbox_uri = data.get("inbox_uri", "")
    attachments_uri = data.get("attachments_uri", "")

    try:
        if source_type == "cloud":
            # Check prefix protocol (s3:// vs gs://)
            if inbox_uri.startswith("s3://"):
                in_count = sync_from_s3(inbox_uri, INBOX_DIR)
                att_count = sync_from_s3(attachments_uri, ATTACHMENTS_DIR)
            elif inbox_uri.startswith("gs://"):
                in_count = sync_from_gcs(inbox_uri, INBOX_DIR)
                att_count = sync_from_gcs(attachments_uri, ATTACHMENTS_DIR)
            else:
                return jsonify({"status": "error", "message": "Invalid cloud URI protocol"}), 400

        elif source_type == "drive":
            in_count = sync_from_gdrive_folder(inbox_uri, INBOX_DIR)
            att_count = sync_from_gdrive_folder(attachments_uri, ATTACHMENTS_DIR)

        else:
            return jsonify({"status": "error", "message": "Unknown source_type"}), 400

        return jsonify({
            "status": "success",
            "source": source_type,
            "inbox_downloaded": in_count,
            "attachments_downloaded": att_count
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500
