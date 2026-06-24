-- Investigation Assistant — initial schema
-- Run in the Supabase SQL Editor, or via `supabase db push` with the CLI.

-- Enums -----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'case_type') then
    create type case_type as enum (
      'mobbing',
      'harassment',
      'discrimination',
      'racism',
      'retaliation'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type document_status as enum (
      'uploaded',
      'extracting',
      'extracted',
      'failed'
    );
  end if;
end$$;

-- Tables ----------------------------------------------------------------------
create table if not exists public.cases (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  company_name text not null,
  case_type    case_type not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.cases (id) on delete cascade,
  file_name      text not null,
  file_url       text not null,
  status         document_status not null default 'uploaded',
  raw_text       text,
  extracted_data jsonb,
  created_at     timestamptz not null default now(),
  extracted_at   timestamptz
);

create index if not exists documents_case_id_idx
  on public.documents (case_id, created_at desc);

create index if not exists cases_created_at_idx
  on public.cases (created_at desc);

-- Row Level Security ----------------------------------------------------------
-- RLS is enabled but no anon/authenticated policies are defined yet: the MVP
-- accesses the database exclusively through the service-role key on the server,
-- which bypasses RLS. When authentication is added, add per-user policies here.
alter table public.cases enable row level security;
alter table public.documents enable row level security;

-- Storage bucket --------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('case-documents', 'case-documents', false)
on conflict (id) do nothing;
