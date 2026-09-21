-- Migration 004: cascade-delete a run's emails and review_audit_log rows
-- when the run itself is deleted, so cleaning up a test/junk run from the
-- Supabase Table Editor is one delete instead of three ordered deletes.
-- Run once by hand in the Supabase SQL editor, AFTER 001-003.
--
-- Before this: deleting a `runs` row while `emails`/`review_audit_log`
-- rows still reference it fails with a foreign key violation (both
-- columns were declared with no ON DELETE behavior, which defaults to
-- NO ACTION/restrict) — that's why Table Editor deletes on `runs` were
-- being rejected.

alter table emails drop constraint if exists emails_run_id_fkey;
alter table emails add constraint emails_run_id_fkey
    foreign key (run_id) references runs(run_id) on delete cascade;

alter table review_audit_log drop constraint if exists review_audit_log_run_id_fkey;
alter table review_audit_log add constraint review_audit_log_run_id_fkey
    foreign key (run_id) references runs(run_id) on delete cascade;
