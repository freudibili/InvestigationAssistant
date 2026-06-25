-- Investigation Analysis — cross-interview analysis persisted per case.
-- The analysis is generated manually by the investigator from the already
-- extracted interviews; it never re-reads the original documents.

alter table public.cases
  add column if not exists investigation_analysis jsonb,
  add column if not exists investigation_analysis_status text not null default 'idle',
  add column if not exists investigation_analysis_run_id uuid,
  add column if not exists investigation_analysis_at timestamptz;
