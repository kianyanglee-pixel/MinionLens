import os
import sys
from pathlib import Path
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent))

from flask import Blueprint, jsonify, request, Response, stream_with_context

from loader import Inbox
from app.classifier import classify_email
from app.extractor import extract_field_pair, extract_fields
from app.evaluator import compare_documents
from app.ingest import (
    BASE_DATA_DIR,
    get_batch_dirs,
    save_uploaded_files_for_batch,
    sync_from_s3,
    sync_from_gcs,
    sync_from_gdrive_folder,
    extract_zip_for_batch
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

bp = Blueprint("api", __name__)

# User-provided LLM keys live only for the duration of a processing run.
# They are never written to Supabase, batch files, or response payloads.
_RUN_LLM_KEYS: dict[str, str | None] = {}

DOC_COMPARISON_CATEGORY = "BL_COMPARISON"


def _db_source_path(run_id: str) -> Path:
    return BASE_DATA_DIR / run_id / "db_source.json"


def _save_custom_db_source(run_id: str, url: str, key: str) -> None:
    """Persists the non-default Supabase project a "database"-source run
    was pointed at, so later requests for this same run_id (stream-process,
    the source drawer, the original-email route) reconnect to the same
    project instead of silently falling back to the server's own default
    SUPABASE_URL/KEY. Lives next to where a local-folder ingest would keep
    its files — this run just has a one-file "folder" instead."""
    path = _db_source_path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"url": url, "key": key}))


def _load_custom_db_source(run_id: str) -> dict | None:
    path = _db_source_path(run_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _resolve_inbox_for_run(run_id: str | None) -> Inbox:
    """Local/Cloud/Drive ingests each get an isolated batch folder under
    BASE_DATA_DIR; a "database"-source run deliberately skips that and is
    read straight from a Supabase project instead — either a custom one the
    user pointed it at (see ingest_batch()), or the server's own default.
    Keeps every run-scoped route (source drawer, original email,
    stream-process) consistently pointed at the same data for a given run."""
    if run_id:
        custom_source = _load_custom_db_source(run_id)
        if custom_source:
            return Inbox("supabase", url=custom_source.get("url"), key=custom_source.get("key"))

        batch_inbox_dir = BASE_DATA_DIR / run_id / "inbox"
        if batch_inbox_dir.exists() and any(batch_inbox_dir.glob("*.json")):
            return Inbox(str(BASE_DATA_DIR / run_id))
    return Inbox("supabase")

def _attachment_role(att_path):
    name = att_path.rsplit("/", 1)[-1].upper()
    if "_SI" in name:
        return "SI"
    if "_BL" in name:
        return "BL"
    return None

def _missing_attachment_result(missing_role, si_path=None, bl_path=None):
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

def _processing_failure_result():
    """Same shape compare_documents() already returns for an extractor-level
    invalid_json response (evaluator.py) — reused here for the other failure
    mode: an LLM call that raised (exhausted retries / network error) instead
    of returning a parseable-but-wrong response. Distinct from a content
    problem, per §2.4-F: no document to view, no judgment to make."""
    return {
        "status": "NEEDS_REVIEW",
        "review_reason": None,
        "processing_failure": True,
        "has_defect": False,
        "defect_fields": [],
        "field_comparisons": {},
    }

def process_email(inbox, email, llm_api_key: str | None = None):
    try:
        classification = classify_email(email, llm_api_key)
    except Exception as exc:
        return {
            "email_id": email.get("email_id"),
            "category": None,
            "classification": {"category": None, "reason": str(exc), "processing_failure": True},
            "comparison": None,
            "processing_failure": True,
        }

    # `or "GENERAL"`, not `.get(..., "GENERAL")` — classify_email() sets
    # category to an explicit None on a processing failure (invalid_json),
    # which .get()'s default doesn't catch, and this category value flows
    # straight into submission.json (report.py) where it must never be null.
    category = classification.get("category") or "GENERAL"

    if category != DOC_COMPARISON_CATEGORY:
        return {
            "email_id": email.get("email_id"),
            "category": category,
            "classification": classification,
            "comparison": None,
            "processing_failure": classification.get("processing_failure", False)
        }

    attachments = email.get("attachments", [])
    si_path = next((p for p in attachments if _attachment_role(p) == "SI"), None)
    bl_path = next((p for p in attachments if _attachment_role(p) == "BL"), None)

    if not si_path or not bl_path:
        comparison = _missing_attachment_result("SI" if not si_path else "BL", si_path, bl_path)
    else:
        try:
            # Use teammate's optimized single-prompt pair extractor
            si_result, bl_result = extract_field_pair(inbox, si_path, bl_path, llm_api_key)
            comparison = compare_documents(si_result, bl_result, llm_api_key)
            comparison["si_path"] = si_path
            comparison["bl_path"] = bl_path
        except Exception:
            # An ask_json() call raised (retries exhausted, network error) —
            # a system fault, not a content problem. Without this, the
            # exception would only be caught far away in stream_batch_
            # process()'s future.result() loop, which just logs a message
            # and never calls save_single_processed_email() — the email
            # would silently vanish from the run instead of showing up as
            # a processing failure (PRD §4.11).
            comparison = _processing_failure_result()
            comparison["si_path"] = si_path
            comparison["bl_path"] = bl_path

    return {
        "email_id": email.get("email_id"),
        "category": category,
        "classification": classification,
        "comparison": comparison,
        "processing_failure": classification.get("processing_failure", False) or (comparison.get("processing_failure", False) if comparison else False)
    }

def _process_and_save_worker(inbox, email_data, run_id: str, dedup_suffix: str = "", llm_api_key: str | None = None):
    raw_id = str(email_data.get("email_id") or "email_unknown")
    email_name = raw_id.replace(".json", "") + dedup_suffix
    # Bare id, not run_id-prefixed — the emails table's real key is the
    # composite (email_id, run_id) (migrations/002_composite_key.sql), so a
    # run_id prefix here was always redundant for uniqueness. Every query
    # that resolves a specific row (resolve_review_item, and the fallback
    # branch in save_single_processed_email) must filter by BOTH columns
    # now that the same bare email_id can legitimately appear in many runs.
    email_id = email_name

    result = process_email(inbox, email_data, llm_api_key)
    # `or "GENERAL"`, not `.get(..., "GENERAL")` — a processing failure
    # (classify_email raised, or returned invalid_json) sets category to an
    # explicit None, which .get()'s default wouldn't catch, and `category`
    # is NOT NULL in the DB schema (migrations/001_init.sql:22-23).
    category = result.get("category") or "GENERAL"
    classification = result.get("classification", {})
    comparison = result.get("comparison")
    is_processing_failure = result.get("processing_failure", False)

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
        # comparison is None either because this category never goes
        # through document comparison (a genuine OK), or because
        # classify_email() itself failed (is_processing_failure=True) —
        # those two cases must not be reported the same way.
        automated_status = "NEEDS_REVIEW" if is_processing_failure else "OK"
        if automated_status == "NEEDS_REVIEW":
            is_needs_review = True
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
        # Reviewer-set only (§2.4-F) — never auto-derived from the
        # automated result. Was previously auto-set to true for every
        # escalated/defect email at processing time, which meant the flag
        # no longer meant anything by the time a human actually looked at
        # the case.
        "awaiting_sender_response": False,
        "is_processing_failure": is_processing_failure,
        "run_id": run_id,
        "processed_at": now,
        "trace": trace_payload
    }

    # A processing failure never enters the Human Review Queue (§2.4-F) — no
    # document to view, no judgment to make — so it gets no placeholder
    # audit row at all, unlike a real content escalation.
    audit_row = None
    if not is_processing_failure and (has_defect or automated_status == "NEEDS_REVIEW"):
        audit_row = {
            "run_id": run_id,
            "email_id": email_id,
            "escalated_at": now,
            # Placeholder row, action-updated later by resolve_review_item()
            # once a reviewer actually acts on it (the unique(email_id,
            # run_id) constraint means this same row is updated, not a new
            # one inserted). review_reason is only meaningful for a
            # NEEDS_REVIEW case; a MISMATCH escalation's real detail lives
            # in defect_fields, not a fabricated review_reason.
            "review_reason": automated_review,
            "automated_result": automated_status,
            "action": "awaiting_sender_response",  # Pass CHECK constraint
            "defect_fields": defect_fields,
        }

    save_single_processed_email(email_row, audit_row)

    return {
        "email_id": email_name,
        "status": automated_status,
        "is_mismatch": is_mismatch,
        "is_needs_review": is_needs_review,
        "is_clear": is_clear,
        "is_spam": is_spam
    }

# ==========================================
# Config Route (lets the "Database" ingest tab pre-fill the default
# connection — the URL alone isn't a secret, the key is never returned)
# ==========================================
@bp.route("/config", methods=["GET"])
def get_config():
    return jsonify({
        "status": "success",
        "default_supabase_url": os.getenv("SUPABASE_URL", ""),
    })

# ==========================================
# Ingestion Route (Batch-Isolated Folders)
# ==========================================
@bp.route("/ingest", methods=["POST"])
def ingest_batch():
    request_data = request.get_json(silent=True) or {}
    llm_api_key = (
        request.form.get("llm_api_key")
        or request_data.get("llm_api_key")
        or ""
    ).strip() or None
    if not llm_api_key:
        return jsonify({
            "status": "error",
            "message": "A Gemini API key is required for every verification run.",
        }), 400

    started_at = (
        request.form.get("started_at") 
        or request_data.get("started_at")
        or datetime.now(timezone.utc).isoformat()
    )

    # 1. Fast In-Memory ZIP Archive Handler
    if "batch_archive" in request.files:
        zip_file = request.files["batch_archive"]
        email_count = int(request.form.get("email_count", 0))

        run_id = init_run_record(started_at=started_at, email_count=email_count)
        _RUN_LLM_KEYS[run_id] = llm_api_key
        in_count, att_count = extract_zip_for_batch(run_id, zip_file)

        return jsonify({
            "status": "success",
            "run_id": run_id,
            "inbox_count": in_count,
            "attachment_count": att_count,
            "started_at": started_at
        })

    # 2. Standard Individual File Uploads
    if "inbox_files" in request.files or "attachment_files" in request.files:
        inbox_files = request.files.getlist("inbox_files")
        attachment_files = request.files.getlist("attachment_files")

        run_id = init_run_record(started_at=started_at, email_count=len(inbox_files))
        _RUN_LLM_KEYS[run_id] = llm_api_key
        in_count, att_count = save_uploaded_files_for_batch(run_id, inbox_files, attachment_files)

        return jsonify({
            "status": "success",
            "run_id": run_id,
            "inbox_count": in_count,
            "attachment_count": att_count,
            "started_at": started_at
        })

    # 3. Cloud (S3/GCS) & Google Drive Ingestion
    data = request_data
    source_type = data.get("source_type") or request.form.get("source_type")
    inbox_uri = data.get("inbox_uri", "") or request.form.get("inbox_uri", "")
    attachments_uri = data.get("attachments_uri", "") or request.form.get("attachments_uri", "")

    # 3a. "Database" source — process the dataset already sitting in a
    # Supabase project's storage directly, no upload/download/local copy at
    # all. `supabase_url`/`supabase_key` optionally point this at ANY
    # Supabase project, not just the server's own default — left blank (or
    # omitted), it connects to whichever project SUPABASE_URL/SUPABASE_KEY
    # in .env already point at. Deliberately does NOT create a local batch
    # folder (get_batch_dirs) — its absence is exactly what tells
    # stream_batch_process() and the other run-scoped routes to read
    # straight from Supabase instead (see _resolve_inbox_for_run()).
    if source_type == "database":
        custom_url = (data.get("supabase_url") or "").strip() or None
        custom_key = (data.get("supabase_key") or "").strip() or None

        # The frontend always pre-fills the URL field with the server's own
        # default (via GET /config), so submitting it unchanged shouldn't
        # count as an override — only a genuinely different project needs
        # its own persisted connection.
        if custom_url and custom_url == os.getenv("SUPABASE_URL"):
            custom_url = None

        try:
            inbox = Inbox("supabase", url=custom_url, key=custom_key)
            in_count = sum(1 for f in inbox._supabase_list("inbox") if f["name"].startswith("email_"))
        except Exception as e:
            return jsonify({"status": "error", "message": f"Could not connect to that database: {e}"}), 400

        run_id = init_run_record(started_at=started_at, email_count=in_count)
        _RUN_LLM_KEYS[run_id] = llm_api_key
        if custom_url or custom_key:
            _save_custom_db_source(run_id, custom_url, custom_key)

        return jsonify({
            "status": "success",
            "run_id": run_id,
            "inbox_count": in_count,
            "attachment_count": None,
            "started_at": started_at
        })

    if source_type in ("cloud", "drive"):
        run_id = init_run_record(started_at=started_at, email_count=0)
        _RUN_LLM_KEYS[run_id] = llm_api_key
        batch_root, inbox_dir, attachments_dir = get_batch_dirs(run_id)

        try:
            if source_type == "cloud":
                if inbox_uri.startswith("s3://"):
                    in_count = sync_from_s3(inbox_uri, inbox_dir)
                    att_count = sync_from_s3(attachments_uri, attachments_dir)
                elif inbox_uri.startswith("gs://"):
                    in_count = sync_from_gcs(inbox_uri, inbox_dir)
                    att_count = sync_from_gcs(attachments_uri, attachments_dir)
                else:
                    return jsonify({"status": "error", "message": "URI must begin with s3:// or gs://"}), 400
            elif source_type == "drive":
                in_count = sync_from_gdrive_folder(inbox_uri, inbox_dir)
                att_count = sync_from_gdrive_folder(attachments_uri, attachments_dir)

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

    # 4. Mandatory Fallback (Prevents TypeError returning None)
    return jsonify({
        "status": "error",
        "message": "No valid upload payload provided (expected 'batch_archive', 'inbox_files', or cloud parameters)."
    }), 400

# ==========================================
# Attachment Inspection Route
# ==========================================
@bp.route("/attachments/content", methods=["GET"])
def get_attachment_content():
    path = request.args.get("path")
    run_id = request.args.get("run_id")
    if not path:
        return jsonify({"status": "error", "message": "path is required"}), 400

    try:
        inbox = _resolve_inbox_for_run(run_id)
        content = inbox.read_text(path)
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 404

# ==========================================
# Original Email Route (source-evidence drawer, PRD §4.8 item 4)
# ==========================================
@bp.route("/emails/<email_name>/original", methods=["GET"])
def get_original_email(email_name):
    """The source drawer needs the *originating email* (sender/subject/
    body), not just its attachments — reads straight from the Inbox by the
    same email_name the emails table already stores, no schema change
    needed."""
    run_id = request.args.get("run_id")
    try:
        inbox = _resolve_inbox_for_run(run_id)
        email = inbox.get(email_name)
        return jsonify({
            "status": "success",
            "sender": email.get("from", ""),
            "subject": email.get("subject", ""),
            "body": email.get("body", ""),
            "attachments": email.get("attachments", []),
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 404

# ==========================================
# Parallel Streaming Verification Route
# ==========================================
@bp.route("/stream-process", methods=["GET"])
def stream_batch_process():
    run_id = request.args.get("run_id")
    if not run_id:
        return {"status": "error", "message": "run_id is required"}, 400

    def generate_events():
        llm_api_key = _RUN_LLM_KEYS.get(run_id)
        inbox = _resolve_inbox_for_run(run_id)
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

        # A duplicate email_id in the dataset must not silently overwrite an
        # earlier record via the upsert in save_single_processed_email()
        # (PRD §4.11) — give every repeat after the first a disambiguating
        # suffix so each still gets its own row, and say so out loud.
        seen_ids = {}
        dedup_suffixes = []
        for email in emails:
            raw_id = str(email.get("email_id") or "email_unknown")
            seen_ids[raw_id] = seen_ids.get(raw_id, 0) + 1
            dedup_suffixes.append(f"__dup{seen_ids[raw_id]}" if seen_ids[raw_id] > 1 else "")
        duplicate_ids = sorted({eid for eid, count in seen_ids.items() if count > 1})
        if duplicate_ids:
            yield f"data: {json.dumps({'stage': 'WARNING', 'message': f'Duplicate email_id(s) in this batch, kept as separate records: {duplicate_ids}', 'current': 0, 'total': total_emails})}\n\n"

        # Kept at 3, not raised — a higher count here (tried 6) got the
        # backend OOM-killed on real hardware while Ollama (a local model,
        # multi-GB resident in memory) was the active provider in llm.py.
        # The active provider is Gemini (cloud API) now, which doesn't have
        # that specific memory constraint, but this is left conservative
        # since Gemini has its own per-project rate limits (llm.py's retry
        # handles a 429 gracefully, but a much higher worker count would
        # just mean more of them). If you switch llm.py back to Ollama,
        # keep this at 3 or lower — see README's OLLAMA_NUM_PARALLEL note.
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = {
                executor.submit(_process_and_save_worker, inbox, email, run_id, dedup_suffixes[i], llm_api_key): email
                for i, email in enumerate(emails)
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
        _RUN_LLM_KEYS.pop(run_id, None)
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
# Run Details and Review Queue Endpoints
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
    # Disambiguated FK — see db.py's get_pending_review_queue() for why.
    emails_res = supabase.table("emails").select("*, review_audit_log!review_audit_log_email_run_fkey(*)").eq("run_id", run["run_id"]).order("processed_at", desc=False).execute()
    return jsonify({"status": "success", "run": run, "emails": emails_res.data or []})

@bp.route("/runs/<run_id>", methods=["GET"])
def get_run_details(run_id):
    supabase = get_supabase()
    run_res = supabase.table("runs").select("*").eq("run_id", run_id).single().execute()
    if not run_res.data:
        return jsonify({"status": "error", "message": "Run not found"}), 404

    emails_res = supabase.table("emails").select("*, review_audit_log!review_audit_log_email_run_fkey(*)").eq("run_id", run_id).order("processed_at", desc=False).execute()
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
    # Matches PRD §4.9's contract exactly: {decision?, defect_fields?, notes,
    # awaiting_sender_response?} — one action covers both outcomes (§2.4-F).
    body = request.get_json() or {}
    decision = body.get("decision")
    defect_fields = body.get("defect_fields")
    notes = body.get("notes", "")
    awaiting_sender_response = bool(body.get("awaiting_sender_response", False))
    resolved_by = body.get("resolved_by", "Operator")
    # Required now that email_id is the bare id (no run_id prefix) — the
    # same email_id can exist in multiple runs, so without this the update
    # would hit every run's row for that email_id, not just this one.
    run_id = body.get("run_id")
    if not run_id:
        return jsonify({"status": "error", "message": "run_id is required"}), 400

    try:
        result = resolve_review_item(
            email_id=email_id,
            run_id=run_id,
            decision=decision,
            defect_fields=defect_fields,
            notes=notes,
            awaiting_sender_response=awaiting_sender_response,
            resolved_by=resolved_by,
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"status": "error", "message": str(e)}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500