"""Postgres access via the Supabase Postgrest client."""
import os
import uuid
from datetime import datetime, timezone
from supabase import create_client

_client = None

def _now():
    return datetime.now(timezone.utc).isoformat()

def get_supabase():
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be configured in .env")
        _client = create_client(url, key)
    return _client

# Must match the emails_automated_review_reason_check constraint in
# migrations/001_init.sql exactly (and PRD §4.4's 4-value enum) — these two
# used to drift (this set had "unreadable_document" instead of "unreadable"
# and was missing "missing_attachment" entirely, so a genuinely-unreadable
# or missing-attachment case would fail the DB's check constraint).
ALLOWED_REVIEW_REASONS = {"wrong_doc_type", "missing_attachment", "unreadable", "missing_value"}

def sanitize_review_reason(reason: str | None) -> str | None:
    """Strictly matches the emails_automated_review_reason_check constraint."""
    if not reason:
        return None
    norm = reason.strip().lower()
    if norm in ALLOWED_REVIEW_REASONS:
        return norm
    if "attachment" in norm:
        return "missing_attachment"
    if "missing" in norm:
        return "missing_value"
    if "unread" in norm or "corrupt" in norm or "parse" in norm or "failed" in norm:
        return "unreadable"
    if "type" in norm or "doc" in norm:
        return "wrong_doc_type"
    return None

# -- Runs ---------------------------------------------------------------

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

def finalize_run_record(run_id: str, counts: dict):
    """Updates the final triage counts and marks completed_at."""
    supabase = get_supabase()
    payload = {
        "completed_at": _now(),
        "mismatch_count": counts.get("mismatch_count", 0),
        "needs_review_count": counts.get("needs_review_count", 0),
        "clear_count": counts.get("clear_count", 0),
        "spam_count": counts.get("spam_count", 0)
    }
    supabase.table("runs").update(payload).eq("run_id", run_id).execute()

# -- Emails & Audit Logs -------------------------------------------------

def save_single_processed_email(email_row: dict, audit_row: dict | None = None):
    """Persists an individual email record safely and handles audit logging."""
    supabase = get_supabase()
    email_id = email_row.get("email_id")

    # Safe upsert handling whether PK is email_id or composite (run_id, email_id)
    run_id = email_row.get("run_id")
    try:
        supabase.table("emails").upsert(email_row, on_conflict="email_id").execute()
    except Exception:
        try:
            supabase.table("emails").upsert(email_row, on_conflict="run_id,email_id").execute()
        except Exception:
            # Fallback: check then insert/update. Scoped by (email_id,
            # run_id) — email_id alone is no longer guaranteed unique
            # across runs, so filtering by it alone here would silently
            # update/miss the wrong run's row.
            check = (
                supabase.table("emails")
                .select("email_id")
                .eq("email_id", email_id)
                .eq("run_id", run_id)
                .execute()
            )
            if check.data:
                supabase.table("emails").update(email_row).eq("email_id", email_id).eq("run_id", run_id).execute()
            else:
                supabase.table("emails").insert(email_row).execute()

    if audit_row:
        try:
            supabase.table("review_audit_log").insert(audit_row).execute()
        except Exception as err:
            print(f"[!] Audit log insert error for {email_id}: {err}")

def get_pending_review_queue():
    supabase = get_supabase()
    response = (
        supabase.table("emails")
        .select("*, review_audit_log(*)")
        .in_("automated_status", ["MISMATCH", "NEEDS_REVIEW"])
        .eq("is_processing_failure", False)
        .order("processed_at", desc=True)
        .execute()
    )
    return response.data

def resolve_review_item(
    email_id: str,
    run_id: str,
    decision: str | None = None,
    defect_fields: list | None = None,
    notes: str | None = None,
    awaiting_sender_response: bool = False,
    resolved_by: str = "Operator",
):
    """One resolve action covers both outcomes the PRD describes (§2.4-F,
    §4.9's POST /resolve contract):
    - `decision` set ("OK" or "MISMATCH"): the reviewer made the call —
      updates current_status, clears current_review_reason, and the audit
      log records a "resolved" action.
    - `decision` omitted, `awaiting_sender_response=True` instead: the
      reviewer couldn't judge it as-is — current_status stays untouched
      (still NEEDS_REVIEW), only the flag is set, and the audit log records
      an "awaiting_sender_response" action. `notes` carries why either way.
    """
    supabase = get_supabase()
    now = _now()

    if decision:
        decision = decision.upper()
        if decision not in ("OK", "MISMATCH"):
            raise ValueError(f"decision must be 'OK' or 'MISMATCH' (PRD §4.4 status enum), got {decision!r}")
        email_update = {
            "current_status": decision,
            "current_review_reason": None,
            "awaiting_sender_response": False,
        }
        if defect_fields is not None:
            email_update["defect_fields"] = defect_fields
            email_update["has_defect"] = bool(defect_fields)
        audit_update = {
            "action": "resolved",  # Strict lowercase to pass CHECK constraint
            "resolved_at": now,
            "resolved_by": resolved_by,
            "human_decision": decision,
            "defect_fields": defect_fields,
            "notes": notes,
        }
    elif awaiting_sender_response:
        email_update = {"awaiting_sender_response": True}
        audit_update = {
            "action": "awaiting_sender_response",
            "resolved_at": now,
            "resolved_by": resolved_by,
            "human_decision": None,
            "notes": notes,
        }
    else:
        raise ValueError("resolve requires either `decision` or `awaiting_sender_response=True`")

    # Scoped by (email_id, run_id) — email_id alone is no longer unique
    # across runs, so an unscoped .eq("email_id", ...) here would resolve
    # this same-named email in every other run too, not just this one.
    supabase.table("emails").update(email_update).eq("email_id", email_id).eq("run_id", run_id).execute()
    supabase.table("review_audit_log").update(audit_update).eq("email_id", email_id).eq("run_id", run_id).execute()

    return {"status": "success", "email_id": email_id, **email_update}