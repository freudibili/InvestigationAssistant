-- Make a case's type optional until it's known.
--
-- A case is often opened before its nature is clear. The case type is now
-- nullable (an "unclassified" case), and `case_type_source` records whether the
-- current type was suggested by the AI extraction or confirmed by the user.

-- Enum: where the current case_type came from ------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'case_type_source') then
    create type case_type_source as enum ('suggested', 'confirmed');
  end if;
end$$;

-- Columns ------------------------------------------------------------------------
alter table public.cases
  alter column case_type drop not null;

alter table public.cases
  add column if not exists case_type_source case_type_source;

-- Backfill: existing cases were set explicitly at creation, so treat them as
-- user-confirmed.
update public.cases
  set case_type_source = 'confirmed'
  where case_type is not null
    and case_type_source is null;

-- Keep the two columns consistent: a source only makes sense with a type.
alter table public.cases
  drop constraint if exists cases_case_type_source_chk;
alter table public.cases
  add constraint cases_case_type_source_chk
  check (
    (case_type is null and case_type_source is null)
    or (case_type is not null and case_type_source is not null)
  );
