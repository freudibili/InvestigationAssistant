alter table public.documents
  add column if not exists corrected_file_url text,
  add column if not exists corrected_raw_text text,
  add column if not exists corrected_source_revision bigint not null default 0;

update public.documents
set corrected_file_url = coalesce(corrected_file_url, file_url),
    corrected_raw_text = coalesce(corrected_raw_text, raw_text)
where corrected_file_url is null
   or corrected_raw_text is null;

alter table public.documents
  alter column corrected_file_url set not null;

create table if not exists public.document_source_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  revision bigint not null,
  file_url text not null,
  raw_text text,
  created_at timestamptz not null default now(),
  unique (document_id, revision)
);

create index if not exists document_source_versions_document_created_idx
  on public.document_source_versions (document_id, created_at desc);

alter table public.document_source_versions enable row level security;

insert into public.document_source_versions (document_id, revision, file_url, raw_text)
select id, corrected_source_revision, corrected_file_url, corrected_raw_text
from public.documents
on conflict (document_id, revision) do nothing;

create or replace function public.record_initial_document_source_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.document_source_versions (document_id, revision, file_url, raw_text)
  values (new.id, new.corrected_source_revision, new.corrected_file_url, new.corrected_raw_text)
  on conflict (document_id, revision) do nothing;
  return new;
end;
$$;

drop trigger if exists record_initial_document_source_version on public.documents;
create trigger record_initial_document_source_version
after insert on public.documents
for each row execute function public.record_initial_document_source_version();

create or replace function public.apply_extraction_review(
  p_document_id uuid,
  p_decision text,
  p_source_version text,
  p_edited_data jsonb,
  p_interviewee_role text,
  p_reason text,
  p_affects_downstream_analysis boolean,
  p_corrected_file_url text,
  p_corrected_raw_text text,
  p_expected_revision bigint
)
returns setof public.documents
language plpgsql
set search_path = ''
as $$
declare
  current_document public.documents%rowtype;
  selected_data jsonb;
  approved_data jsonb;
  selected_file_url text;
  selected_raw_text text;
  next_corrected_file_url text;
  next_corrected_raw_text text;
  source_changed boolean;
begin
  select * into current_document
  from public.documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Document not found.';
  end if;

  if current_document.extraction_revision <> p_expected_revision then
    raise exception 'Extraction changed since it was opened. Reload and try again.';
  end if;

  if current_document.status = 'extracting' then
    raise exception 'Wait for extraction to finish before making corrections.';
  end if;

  selected_data := case p_source_version
    when 'ai' then current_document.ai_extracted_data
    when 'edited' then current_document.investigator_extracted_data
    when 'approved' then current_document.approved_extracted_data
    else null
  end;

  selected_file_url := case p_source_version
    when 'ai' then current_document.ai_file_url
    when 'edited' then current_document.corrected_file_url
    when 'approved' then current_document.approved_file_url
    else null
  end;

  selected_raw_text := case p_source_version
    when 'ai' then current_document.ai_raw_text
    when 'edited' then current_document.corrected_raw_text
    when 'approved' then current_document.approved_raw_text
    else null
  end;

  next_corrected_file_url := coalesce(
    p_corrected_file_url,
    current_document.corrected_file_url,
    selected_file_url
  );
  next_corrected_raw_text := coalesce(
    p_corrected_raw_text,
    current_document.corrected_raw_text,
    selected_raw_text
  );
  source_changed :=
    next_corrected_file_url is distinct from current_document.corrected_file_url
    or next_corrected_raw_text is distinct from current_document.corrected_raw_text;

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
        corrected_file_url = next_corrected_file_url,
        corrected_raw_text = next_corrected_raw_text,
        corrected_source_revision = corrected_source_revision + case when source_changed then 1 else 0 end,
        file_url = next_corrected_file_url,
        raw_text = next_corrected_raw_text,
        extraction_review_status = 'edited',
        extraction_edited_at = now(),
        extraction_revision = extraction_revision + 1
    where id = p_document_id;

    if source_changed then
      insert into public.document_source_versions (document_id, revision, file_url, raw_text)
      values (
        current_document.id,
        current_document.corrected_source_revision + 1,
        next_corrected_file_url,
        next_corrected_raw_text
      );
    end if;
  elsif p_decision = 'approve' then
    if selected_data is null then
      raise exception 'The selected extraction version is not available.';
    end if;
    approved_data := selected_data;
    update public.documents
    set approved_extracted_data = selected_data,
        approved_file_url = selected_file_url,
        approved_raw_text = selected_raw_text,
        extraction_review_status = 'approved',
        extraction_approved_at = now(),
        extraction_revision = extraction_revision + 1
    where id = p_document_id;
  elsif p_decision in ('reject', 'exclude') then
    update public.documents
    set approved_extracted_data = null,
        approved_file_url = null,
        approved_raw_text = null,
        extraction_review_status = case when p_decision = 'exclude' then 'excluded' else 'needs_review' end,
        extraction_approved_at = null,
        extraction_revision = extraction_revision + 1
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
    original_source_file_url,
    edited_source_file_url,
    approved_source_file_url,
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
    current_document.original_file_url,
    case when p_decision = 'edit' then next_corrected_file_url else current_document.corrected_file_url end,
    case when p_decision = 'approve' then selected_file_url else null end,
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

revoke execute on function public.apply_extraction_review(uuid, text, text, jsonb, text, text, boolean, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.apply_extraction_review(uuid, text, text, jsonb, text, text, boolean, text, text, bigint)
  to service_role;

revoke all on table public.document_source_versions from public, anon, authenticated;
grant select, insert on table public.document_source_versions to service_role;
