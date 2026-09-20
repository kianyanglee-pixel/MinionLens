import sys
from pathlib import Path

# classifier.py / extractor.py / evaluator.py each do `from llm import ask_json`,
# expecting llm.py to be a top-level module. It actually lives in this same
# app/ folder, so make that folder importable as top-level before pulling
# those modules in. (Doesn't touch classifier.py/extractor.py/evaluator.py/llm.py.)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Blueprint, jsonify

from loader import Inbox
from app.classifier import classify_email
from app.extractor import extract_fields
from app.evaluator import compare_documents

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
