-- Migration 003: give review_audit_log a run_id column and make
-- (email_id, run_id) unique, so only one audit action can be logged per
-- email per run. Run once by hand in the Supabase SQL editor, AFTER
-- 001_init.sql and 002_composite_key.sql.
--
-- Note: existing rows will have run_id = NULL after this runs (there was
-- no run_id captured before). That's fine — SQL treats each NULL as
-- distinct for uniqueness purposes, so old rows never collide with each
-- other or with new ones. New rows going forward always carry a real
-- run_id (routes.py now passes it through).

alter table review_audit_log add column if not exists run_id text references runs(run_id);

alter table review_audit_log drop constraint if exists review_audit_log_email_run_unique;
alter table review_audit_log add constraint review_audit_log_email_run_unique unique (email_id, run_id);
