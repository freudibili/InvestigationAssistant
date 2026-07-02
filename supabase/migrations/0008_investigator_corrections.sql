alter table public.documents
  add column if not exists ai_extracted_data jsonb,
  add column if not exists investigator_extracted_data jsonb,
  add column if not exists approved_extracted_data jsonb,
  add column if not exists extraction_review_status text not null default 'ai_generated',
  add column if not exists extraction_edited_at timestamptz,
  add column if not exists extraction_approved_at timestamptz;

update public.documents
set ai_extracted_data = extracted_data
where ai_extracted_data is null and extracted_data is not null;

alter table public.documents
  drop constraint if exists documents_extraction_review_status_check,
  add constraint documents_extraction_review_status_check
    check (extraction_review_status in ('ai_generated', 'edited', 'needs_review', 'approved', 'excluded'));

alter table public.cases
  add column if not exists ai_investigation_analysis jsonb,
  add column if not exists investigator_investigation_analysis jsonb,
  add column if not exists approved_investigation_analysis jsonb,
  add column if not exists investigation_analysis_review_status text not null default 'ai_generated',
  add column if not exists investigation_analysis_edited_at timestamptz,
  add column if not exists investigation_analysis_approved_at timestamptz,
  add column if not exists analysis_outdated_document_ids uuid[] not null default '{}';

update public.cases
set ai_investigation_analysis = investigation_analysis
where ai_investigation_analysis is null and investigation_analysis is not null;

alter table public.cases
  drop constraint if exists cases_investigation_analysis_review_status_check,
  add constraint cases_investigation_analysis_review_status_check
    check (investigation_analysis_review_status in ('ai_generated', 'edited', 'needs_review', 'approved', 'excluded', 'outdated'));

create table if not exists public.investigator_change_audit (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  subject_type text not null check (subject_type in ('extraction', 'analysis')),
  subject_id text not null,
  action text not null check (action in ('edit', 'approve', 'reject', 'exclude', 'merge')),
  original_ai_value jsonb,
  edited_value jsonb,
  approved_value jsonb,
  modification_reason text,
  affects_downstream_analysis boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists investigator_change_audit_case_created_idx
  on public.investigator_change_audit (case_id, created_at desc);

create index if not exists investigator_change_audit_document_created_idx
  on public.investigator_change_audit (document_id, created_at desc)
  where document_id is not null;

alter table public.investigator_change_audit enable row level security;

create or replace function public.apply_extraction_review(
  p_document_id uuid,
  p_decision text,
  p_source_version text,
  p_edited_data jsonb,
  p_interviewee_role text,
  p_reason text,
  p_affects_downstream_analysis boolean
)
returns setof public.documents
language plpgsql
set search_path = ''
as $$
declare
  current_document public.documents%rowtype;
  selected_data jsonb;
  approved_data jsonb;
begin
  select * into current_document
  from public.documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Document not found.';
  end if;

  selected_data := case p_source_version
    when 'ai' then current_document.ai_extracted_data
    when 'edited' then current_document.investigator_extracted_data
    when 'approved' then current_document.approved_extracted_data
    else null
  end;

  if p_decision = 'edit' then
    if p_edited_data is null then
      raise exception 'Corrected extraction is required.';
    end if;
    if p_interviewee_role not in ('claimant', 'accused', 'witness') then
      raise exception 'Interviewee role is not valid.';
    end if;

    update public.documents
    set investigator_extracted_data = p_edited_data,
        interviewee_role = p_interviewee_role::public.interviewee_role,
        extraction_review_status = 'edited',
        extraction_edited_at = now()
    where id = p_document_id;
  elsif p_decision = 'approve' then
    if selected_data is null then
      raise exception 'The selected extraction version is not available.';
    end if;
    approved_data := selected_data;
    update public.documents
    set approved_extracted_data = selected_data,
        extraction_review_status = 'approved',
        extraction_approved_at = now()
    where id = p_document_id;
  elsif p_decision in ('reject', 'exclude') then
    update public.documents
    set approved_extracted_data = null,
        extraction_review_status = case when p_decision = 'exclude' then 'excluded' else 'needs_review' end,
        extraction_approved_at = null
    where id = p_document_id;
  else
    raise exception 'Extraction review decision is not valid.';
  end if;

  insert into public.investigator_change_audit (
    case_id,
    document_id,
    subject_type,
    subject_id,
    action,
    original_ai_value,
    edited_value,
    approved_value,
    modification_reason,
    affects_downstream_analysis
  ) values (
    current_document.case_id,
    current_document.id,
    'extraction',
    current_document.id::text,
    p_decision,
    current_document.ai_extracted_data,
    case when p_decision = 'edit' then p_edited_data else current_document.investigator_extracted_data end,
    approved_data,
    nullif(btrim(p_reason), ''),
    p_affects_downstream_analysis
  );

  if p_affects_downstream_analysis then
    update public.cases
    set investigation_analysis_review_status = 'outdated',
        analysis_outdated_document_ids = array(
          select distinct document_id
          from unnest(analysis_outdated_document_ids || p_document_id) as document_id
        )
    where id = current_document.case_id
      and investigation_analysis is not null;
  end if;

  return query select * from public.documents where id = p_document_id;
end;
$$;

create or replace function public.apply_analysis_review(
  p_case_id uuid,
  p_decision text,
  p_source_version text,
  p_analysis jsonb,
  p_reason text,
  p_action text
)
returns setof public.cases
language plpgsql
set search_path = ''
as $$
declare
  current_case public.cases%rowtype;
  selected_analysis jsonb;
  approved_analysis jsonb;
  approved_reproches jsonb;
begin
  select * into current_case
  from public.cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'Case not found.';
  end if;

  selected_analysis := case p_source_version
    when 'ai' then current_case.ai_investigation_analysis
    when 'edited' then current_case.investigator_investigation_analysis
    when 'approved' then current_case.approved_investigation_analysis
    else null
  end;

  if p_decision = 'edit' then
    if p_analysis is null then
      raise exception 'Corrected analysis is required.';
    end if;
    update public.cases
    set investigator_investigation_analysis = p_analysis,
        investigation_analysis_review_status = 'edited',
        investigation_analysis_edited_at = now()
    where id = p_case_id;
  elsif p_decision = 'approve' then
    if selected_analysis is null then
      raise exception 'The selected analysis version is not available.';
    end if;
    select coalesce(jsonb_agg(
      case
        when reproche->>'reviewStatus' = 'excluded' then reproche
        else jsonb_set(reproche, '{reviewStatus}', '"approved"'::jsonb)
      end
    ), '[]'::jsonb)
    into approved_reproches
    from jsonb_array_elements(coalesce(selected_analysis->'reproches', '[]'::jsonb)) as reproche;

    approved_analysis := jsonb_set(selected_analysis, '{reproches}', approved_reproches);
    update public.cases
    set approved_investigation_analysis = approved_analysis,
        investigation_analysis_review_status = 'approved',
        investigation_analysis_approved_at = now(),
        analysis_outdated_document_ids = '{}'
    where id = p_case_id;
  elsif p_decision in ('reject', 'exclude') then
    update public.cases
    set approved_investigation_analysis = null,
        investigation_analysis_review_status = case when p_decision = 'exclude' then 'excluded' else 'needs_review' end,
        investigation_analysis_approved_at = null
    where id = p_case_id;
  else
    raise exception 'Analysis review decision is not valid.';
  end if;

  insert into public.investigator_change_audit (
    case_id,
    document_id,
    subject_type,
    subject_id,
    action,
    original_ai_value,
    edited_value,
    approved_value,
    modification_reason,
    affects_downstream_analysis
  ) values (
    current_case.id,
    null,
    'analysis',
    current_case.id::text,
    case when p_decision = 'edit' then p_action else p_decision end,
    current_case.ai_investigation_analysis,
    case when p_decision = 'edit' then p_analysis else current_case.investigator_investigation_analysis end,
    approved_analysis,
    nullif(btrim(p_reason), ''),
    false
  );

  return query select * from public.cases where id = p_case_id;
end;
$$;
