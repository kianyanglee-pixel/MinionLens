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

create table if not exists emails (
    email_id                   text primary key,
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
    run_id                       text references runs(run_id),
    processed_at                 timestamptz,
    trace                        jsonb
);

create index if not exists emails_run_id_idx on emails(run_id);

create table if not exists review_audit_log (
    id                bigserial primary key,
    email_id          text not null references emails(email_id),
    escalated_at      timestamptz,
    review_reason     text,
    automated_result  text,
    action            text not null check (action in ('resolved', 'awaiting_sender_response', 'retried')),
    resolved_at       timestamptz,
    resolved_by       text,
    human_decision    text,
    defect_fields     jsonb,
    notes             text
);

create index if not exists review_audit_log_email_id_idx on review_audit_log(email_id);
