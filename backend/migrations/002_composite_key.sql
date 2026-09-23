-- Migration 002: switch emails' key from email_id alone to (email_id,
-- run_id), so reprocessing an email in a new run keeps its old rows
-- instead of overwriting them (history survives across runs).
-- Run once by hand in the Supabase SQL editor, AFTER 001_init.sql.
--
-- Note: this does not physically reorder existing columns to put
-- processed_at first — Postgres has no in-place "move column" operation
-- short of rebuilding the table. Column order has no effect on querying
-- (always select/reference by name), so this is left as a cosmetic-only
-- gap for an already-created table; a fresh install via 001_init.sql
-- already creates the table with processed_at first.
--
-- Historical note: 001_init.sql was later hand-edited to already declare
-- `primary key (email_id, run_id)` directly, so on a FRESH install this
-- migration is a no-op (the drop/add here just re-affirms what 001
-- already created). Kept only for projects that ran 001 before that edit
-- and still need to migrate forward from the old email_id-only key.

-- Older databases may have either the email_id-only foreign key or the
-- composite foreign key. Both depend on the current primary-key index and
-- must be removed before replacing it.
alter table review_audit_log drop constraint if exists review_audit_log_email_id_fkey;
alter table review_audit_log drop constraint if exists review_audit_log_email_run_fkey;

alter table emails drop constraint if exists emails_pkey;
alter table emails add primary key (email_id, run_id);
