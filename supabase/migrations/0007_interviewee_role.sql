-- Interviewee party role on documents.
-- Lets the investigator declare whether a transcript is the claimant, the
-- accused, or a reference person/witness *before* extraction, so the model no
-- longer infers (and sometimes inverts) who the claimant and accused are.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'interviewee_role') then
    create type interviewee_role as enum (
      'claimant',
      'accused',
      'witness'
    );
  end if;
end$$;

alter table public.documents
  add column if not exists interviewee_role interviewee_role;

-- Backfill the already-seeded interviews so they don't need manual tagging.
-- Any other pre-existing rows stay null and are tagged in the UI before
-- extraction. Matched on file name; only fills rows that are still untagged.
update public.documents set interviewee_role = 'claimant'
  where interviewee_role is null
    and file_name = 'Besprechung mit Philippe.docx';
update public.documents set interviewee_role = 'accused'
  where interviewee_role is null
    and file_name = 'Besprechung avec personne mise en cause.docx';
update public.documents set interviewee_role = 'witness'
  where interviewee_role is null
    and file_name = 'Entretien Teams Serge.docx';
