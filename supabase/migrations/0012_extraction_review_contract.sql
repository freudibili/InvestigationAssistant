create or replace function public.apply_extraction_review(
  p_document_id uuid,
  p_decision text,
  p_source_version text,
  p_edited_data jsonb,
  p_interviewee_role text,
  p_reason text,
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
  selected_file_url text;
  selected_raw_text text;
  next_corrected_file_url text;
  next_corrected_raw_text text;
  approved_data jsonb;
  approved_file_url text;
  source_changed boolean;
  invalidates_analysis boolean := false;
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

  if p_source_version not in ('ai', 'edited', 'approved') then
    raise exception 'Extraction version is not valid.';
  end if;

  selected_data := case p_source_version
    when 'ai' then current_document.ai_extracted_data
    when 'edited' then current_document.investigator_extracted_data
    when 'approved' then current_document.approved_extracted_data
  end;
  selected_file_url := case p_source_version
    when 'ai' then current_document.ai_file_url
    when 'edited' then current_document.corrected_file_url
    when 'approved' then current_document.approved_file_url
  end;
  selected_raw_text := case p_source_version
    when 'ai' then current_document.ai_raw_text
    when 'edited' then current_document.corrected_raw_text
    when 'approved' then current_document.approved_raw_text
  end;

  if p_decision = 'edit' then
    if p_edited_data is null then
      raise exception 'Corrected extraction is required.';
    end if;
    if p_interviewee_role not in ('claimant', 'accused', 'witness') then
      raise exception 'Interviewee role is not valid.';
    end if;

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
  elsif p_decision = 'approve' then
    if selected_data is null or selected_file_url is null then
      raise exception 'The selected extraction version is not available.';
    end if;

    approved_data := selected_data;
    approved_file_url := selected_file_url;
    invalidates_analysis :=
      selected_data is distinct from current_document.approved_extracted_data
      or selected_file_url is distinct from current_document.approved_file_url
      or selected_raw_text is distinct from current_document.approved_raw_text;

    update public.documents
    set approved_extracted_data = selected_data,
        approved_file_url = selected_file_url,
        approved_raw_text = selected_raw_text,
        extraction_review_status = 'approved',
        extraction_approved_at = now(),
        extraction_revision = extraction_revision + 1
    where id = p_document_id;
  elsif p_decision = 'exclude' then
    invalidates_analysis := current_document.approved_extracted_data is not null;

    update public.documents
    set approved_extracted_data = null,
        approved_file_url = null,
        approved_raw_text = null,
        extraction_review_status = 'excluded',
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
    approved_file_url,
    nullif(btrim(p_reason), ''),
    invalidates_analysis
  );

  if invalidates_analysis then
    update public.cases
    set investigation_analysis = null,
        investigation_analysis_status = 'idle',
        investigation_analysis_run_id = null,
        investigation_analysis_at = null
    where id = current_document.case_id
      and investigation_analysis is not null;
  end if;

  return query select * from public.documents where id = p_document_id;
end;
$$;

revoke execute on function public.apply_extraction_review(uuid, text, text, jsonb, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.apply_extraction_review(uuid, text, text, jsonb, text, text, text, text, bigint)
  to service_role;
