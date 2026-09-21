import os
import uuid
from datetime import datetime, timezone
from supabase import create_client

def get_supabase():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be configured in .env")
    return create_client(url, key)

ALLOWED_REVIEW_REASONS = {"missing_value", "wrong_doc_type", "unreadable_document"}

def sanitize_review_reason(reason: str | None) -> str | None:
    """Strictly matches the emails_automated_review_reason_check constraint."""
    if not reason:
        return None
    norm = reason.strip().lower()
    if norm in ALLOWED_REVIEW_REASONS:
        return norm
    if "missing" in norm:
        return "missing_value"
    if "unread" in norm or "corrupt" in norm or "parse" in norm or "failed" in norm:
        return "unreadable_document"
    if "type" in norm or "doc" in norm:
        return "wrong_doc_type"
    return None

def init_run_record(started_at: str, email_count: int) -> str:
    supabase = get_supabase()
    run_id = f"run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"

    payload = {
        "run_id": run_id,
        "started_at": started_at,
        "email_count": email_count,
        "mismatch_count": 0,
        "needs_review_count": 0,
        "clear_count": 0,
        "spam_count": 0
    }
    supabase.table("runs").insert(payload).execute()
    return run_id

def save_single_processed_email(email_row: dict, audit_row: dict | None = None):
    """Persists an individual email record immediately upon completion."""
    supabase = get_supabase()
    supabase.table("emails").upsert(email_row, on_conflict="email_id").execute()
    if audit_row:
        supabase.table("review_audit_log").insert(audit_row).execute()

def finalize_run_record(run_id: str, counts: dict):
    """Updates the final triage counts and marks completed_at."""
    supabase = get_supabase()
    payload = {
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "mismatch_count": counts.get("mismatch_count", 0),
        "needs_review_count": counts.get("needs_review_count", 0),
        "clear_count": counts.get("clear_count", 0),
        "spam_count": counts.get("spam_count", 0)
    }
    supabase.table("runs").update(payload).eq("run_id", run_id).execute()

def get_pending_review_queue():
    supabase = get_supabase()
    response = (
        supabase.table("emails")
        .select("*, review_audit_log(*)")
        .in_("automated_status", ["MISMATCH", "NEEDS_REVIEW"])
        .order("processed_at", desc=True)
        .execute()
    )
    return response.data

def resolve_review_item(email_id: str, decision: str, resolved_by: str = "Operator", notes: str = None):
    supabase = get_supabase()
    now = datetime.now(timezone.utc).isoformat()

    audit_update = {
        "action": "RESOLVED",
        "resolved_at": now,
        "resolved_by": resolved_by,
        "human_decision": decision,
        "notes": notes
    }
    supabase.table("review_audit_log").update(audit_update).eq("email_id", email_id).execute()

    email_status = "OK" if decision.upper() == "APPROVED" else "REJECTED"
    supabase.table("emails").update({
        "current_status": email_status,
        "current_review_reason": f"Resolved by {resolved_by}: {decision}"
    }).eq("email_id", email_id).execute()

    return {"status": "success", "email_id": email_id, "current_status": email_status}