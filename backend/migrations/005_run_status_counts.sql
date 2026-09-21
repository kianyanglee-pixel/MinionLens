-- Migration 005: add clear_count and spam_count to runs.
-- Run once by hand in the Supabase SQL editor, AFTER 001-004.
--
-- These two columns are already live on the project's own Supabase
-- instance (added by hand at some point, not through a tracked
-- migration) — app/db.py's init_run_record()/finalize_run_record() and
-- routes.py's stream_batch_process() have relied on them ever since.
-- Anyone setting up a FRESH Supabase project from 001-004 alone would
-- hit a rejected insert the moment a batch runs, since those columns
-- would not exist. This migration makes that implicit schema change
-- explicit and reproducible.

alter table runs add column if not exists clear_count integer default 0;
alter table runs add column if not exists spam_count integer default 0;
