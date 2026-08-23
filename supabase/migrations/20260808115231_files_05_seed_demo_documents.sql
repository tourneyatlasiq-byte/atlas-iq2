-- Demo document metadata so Files and the player/tournament document sections
-- render realistically for review.
--
-- IMPORTANT: metadata only. No file was uploaded, so "View or download" fails
-- on these. They exist to show the list, drawer and relationship surfaces.
-- Remove with:  delete from documents where notes like '[demo]%';

insert into documents
  (id, organization_id, season_id, player_id, tournament_id, category, file_name,
   file_path, mime_type, file_size, uploaded_by, uploaded_at, notes)
select
  d.id,
  'a71a5000-0000-0000-0000-000000000001'::uuid,
  case when d.org_wide then null else 'a71a5000-0000-0000-0000-000000000003'::uuid end,
  d.player_id,
  d.tournament_id,
  d.category,
  d.file_name,
  'a71a5000-0000-0000-0000-000000000001/'
    || case when d.org_wide then 'general' else 'a71a5000-0000-0000-0000-000000000003' end
    || '/' || d.id::text || '-' || d.file_name,
  d.mime,
  d.size,
  '9e66ec43-a138-4945-be27-351dffcb1004'::uuid,
  d.uploaded,
  d.note
from (values
  ('f0000000-0000-0000-0000-000000000001'::uuid,'Insurance','2026-27-liability-certificate.pdf',
   'application/pdf', 284133, true, null::uuid, null::uuid,
   timestamptz '2026-07-14 09:12', '[demo] Season liability policy, expires 31 July 2027'),
  ('f0000000-0000-0000-0000-000000000002','Sanctioning / Roster','usa-softball-2026-roster.pdf',
   'application/pdf', 96204, true, null, null,
   timestamptz '2026-07-22 16:40', '[demo] Submitted to USA Softball'),
  ('f0000000-0000-0000-0000-000000000003','Team Form','2026-27-code-of-conduct.pdf',
   'application/pdf', 61880, true, null, null,
   timestamptz '2026-07-02 11:05', '[demo] Signed by every family before the first practice'),
  ('f0000000-0000-0000-0000-000000000004','Birth Certificate','alpha-ava-birth-certificate.pdf',
   'application/pdf', 412903, false,'a71a5000-0000-0000-0000-000000000101'::uuid, null,
   timestamptz '2026-07-18 14:22', '[demo] Verified against passport'),
  ('f0000000-0000-0000-0000-000000000005','Birth Certificate','bravo-bella-birth-certificate.pdf',
   'application/pdf', 388217, false,'a71a5000-0000-0000-0000-000000000102'::uuid, null,
   timestamptz '2026-07-18 14:26', '[demo]'),
  ('f0000000-0000-0000-0000-000000000006','Waiver','charlie-cora-medical-release.pdf',
   'application/pdf', 74551, false,'a71a5000-0000-0000-0000-000000000103'::uuid, null,
   timestamptz '2026-07-25 08:55', '[demo] Parent signed, on file for the season'),
  ('f0000000-0000-0000-0000-000000000007','Tournament Document','fall-kickoff-schedule.pdf',
   'application/pdf', 152340, false, null,'a71a5000-0000-0000-0000-000000000301'::uuid,
   timestamptz '2026-08-01 19:30', '[demo] Pool play schedule released by the provider'),
  ('f0000000-0000-0000-0000-000000000008','Tournament Document','fall-kickoff-field-map.png',
   'image/png', 863221, false, null,'a71a5000-0000-0000-0000-000000000301'::uuid,
   timestamptz '2026-08-01 19:32', '[demo] Parking is off Bells Ferry, not Towne Lake'),
  ('f0000000-0000-0000-0000-000000000009','Receipt','peach-state-entry-receipt.pdf',
   'application/pdf', 44120, false, null,'a71a5000-0000-0000-0000-000000000302'::uuid,
   timestamptz '2026-09-15 10:14', '[demo] Entry fee paid by card'),
  ('f0000000-0000-0000-0000-00000000000a','Other','uniform-order-confirmation.pdf',
   'application/pdf', 128744, true, null, null,
   timestamptz '2026-08-05 13:08', '[demo] Diamond Threads, 12 sets')
) as d(id, category, file_name, mime, size, org_wide, player_id, tournament_id, uploaded, note);
