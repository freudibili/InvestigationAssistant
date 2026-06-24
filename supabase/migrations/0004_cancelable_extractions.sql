-- Allow investigators to cancel long-running extraction jobs.

alter type document_status add value if not exists 'canceled';

alter table public.documents
  add column if not exists extraction_run_id uuid;
