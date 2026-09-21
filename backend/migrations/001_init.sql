-- Tier 1 persistence schema (PRD §6.3 / §4.4).
-- Run once by hand in the Supabase SQL editor for this project.

create table if not exists runs (
    run_id              text primary key,
    started_at          timestamptz not null default now(),
    completed_at        timestamptz,
    email_count         integer,
    mismatch_count      integer,
    needs_review_count  integer
);

-- email_id alone is NOT the key: the same email can appear once per run
-- (rerunning a batch must not overwrite the previous run's row for it, so
-- history survives). processed_at is listed first purely so it's the
-- leftmost/eyeballed column in the Supabase table view — it is NOT part
-- of the key.
create table if not exists emails (
    processed_at                timestamptz,
    email_id                    text,
    run_id                       text references runs(run_id),
    category                   text not null check (category in
        ('BL_COMPARISON', 'SI_REQUEST', 'INVOICE_QUERY', 'GENERAL', 'SPAM')),
    automated_status            text check (automated_status in ('OK', 'MISMATCH', 'NEEDS_REVIEW')),
    automated_review_reason     text check (automated_review_reason in
        ('wrong_doc_type', 'missing_attachment', 'unreadable', 'missing_value')),
    current_status               text check (current_status in ('OK', 'MISMATCH', 'NEEDS_REVIEW')),
    current_review_reason        text check (current_review_reason in
        ('wrong_doc_type', 'missing_attachment', 'unreadable', 'missing_value')),
    has_defect                   boolean not null default false,
    defect_fields                jsonb not null default '[]',
    awaiting_sender_response     boolean not null default false,
    is_processing_failure        boolean not null default false,
    trace                        jsonb,
    primary key (email_id, run_id)
);

create index if not exists emails_run_id_idx on emails(run_id);

-- email_id here has no foreign key: emails' key is now (email_id, run_id),
-- and a plain email_id is no longer guaranteed unique on its own.
-- (email_id, run_id) is unique: only one audit action can be logged per
-- email per run — a second resolve/awaiting/retry on the same email+run
-- needs a fresh run to get its own audit row, not a second insert here.
create table if not exists review_audit_log (
    id                bigserial primary key,
    email_id          text not null,
    run_id            text references runs(run_id),
    escalated_at      timestamptz,
    review_reason     text,
    automated_result  text,
    action            text not null check (action in ('resolved', 'awaiting_sender_response', 'retried')),
    resolved_at       timestamptz,
    resolved_by       text,
    human_decision    text,
    defect_fields     jsonb,
    notes             text,
    unique (email_id, run_id)
);

create index if not exists review_audit_log_email_id_idx on review_audit_log(email_id);
