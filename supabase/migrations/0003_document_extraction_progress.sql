-- Track long-running AI extraction progress so the UI can show meaningful
-- intermediate steps while the server is processing large documents.

alter table public.documents
  add column if not exists extraction_current_step integer not null default 0,
  add column if not exists extraction_total_steps integer not null default 0,
  add column if not exists extraction_step text;

alter table public.documents
  drop constraint if exists documents_extraction_progress_chk;
alter table public.documents
  add constraint documents_extraction_progress_chk
  check (
    extraction_current_step >= 0
    and extraction_total_steps >= 0
    and extraction_current_step <= extraction_total_steps
  );
