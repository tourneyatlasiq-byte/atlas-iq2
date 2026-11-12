-- QAB plate appearance notes (2026-11).
--
-- plate_appearances.notes has existed since qab_01 and is now used for an
-- optional coach note on one plate appearance: context the QAB reason doesn't
-- capture. The application trims notes, stores blank as null and refuses more
-- than 280 characters before writing. This constraint is the backstop for any
-- write that does not go through the application.
--
-- char_length counts characters (code points), as the application does.
-- Metadata-only: production had 0 notes when this was written (2026-11-12),
-- so validation scans the table and changes no row.
--
-- Notes are context only. No count, percentage, QAB status, game result or
-- record reads this column; the qab_* views and the application tallies use
-- qab_reasons / is_qab and voided_at only.

alter table public.plate_appearances
  add constraint plate_appearances_notes_length
  check (notes is null or char_length(notes) <= 280);

comment on column public.plate_appearances.notes is
  'Optional coach note on this plate appearance (max 280 characters). Context only: never used in any QAB, result or record calculation, and not included in parent-facing outputs.';
