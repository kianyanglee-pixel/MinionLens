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

alter table review_audit_log drop constraint if exists review_audit_log_email_id_fkey;

alter table emails drop constraint if exists emails_pkey;
alter table emails add primary key (email_id, run_id);
