"""Postgres access via the supabase-py Postgrest client (same SUPABASE_URL/
SUPABASE_KEY project as loader.py's Storage client, just the DB side)."""
import os
import uuid
from datetime import datetime, timezone

_client = None


def _now():
    return datetime.now(timezone.utc).isoformat()


def _supabase():
    global _client
    if _client is None:
        from supabase import create_client  # lazy import: optional dependency
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("db.py needs SUPABASE_URL and SUPABASE_KEY in the environment")
        _client = create_client(url, key)
    return _client


# -- runs ---------------------------------------------------------------

def create_run() -> str:
    run_id = str(uuid.uuid4())
    _supabase().table("runs").insert({"run_id": run_id, "started_at": _now()}).execute()
    return run_id


def finalize_run(run_id: str, email_count: int, mismatch_count: int, needs_review_count: int):
    _supabase().table("runs").update({
        "completed_at": _now(),
        "email_count": email_count,
        "mismatch_count": mismatch_count,
        "needs_review_count": needs_review_count,
    }).eq("run_id", run_id).execute()


def list_runs() -> list:
    res = _supabase().table("runs").select("*").order("started_at", desc=True).execute()
    return res.data


# -- emails ---------------------------------------------------------------
# Keyed on (email_id, run_id), not email_id alone: reprocessing an email in
# a later run adds a new row instead of overwriting the old one, so history
# across runs survives. get_email_row()/update_email_resolution() only take
# email_id (matching how routes.py already calls them) and resolve that to
# the most recent row for that email, by processed_at.

def upsert_email_row(row: dict):
    _supabase().table("emails").upsert(row, on_conflict="email_id,run_id").execute()


def get_email_row(email_id: str):
    res = (
        _supabase().table("emails").select("*").eq("email_id", email_id)
        .order("processed_at", desc=True).limit(1).execute()
    )
    return res.data[0] if res.data else None


def update_email_resolution(email_id: str, **fields):
    latest = get_email_row(email_id)
    if latest is None:
        return
    _supabase().table("emails").update(fields).eq("email_id", email_id).eq("run_id", latest["run_id"]).execute()


def list_run_emails(run_id: str) -> list:
    res = (
        _supabase()
        .table("emails")
        .select("email_id,category,current_status,current_review_reason,has_defect")
        .eq("run_id", run_id)
        .execute()
    )
    return res.data


# -- audit log --------------------------------------------------------------

def insert_audit_log_row(row: dict):
    _supabase().table("review_audit_log").insert(row).execute()
