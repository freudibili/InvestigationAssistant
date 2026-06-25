-- Persist per-page extraction drafts so a failed or canceled extraction can be
-- resumed from where it stopped instead of re-running every page through the
-- model. Drafts are stored while a run is in progress and cleared once the
-- document is fully extracted.

alter table public.documents
  add column if not exists extraction_drafts jsonb;
