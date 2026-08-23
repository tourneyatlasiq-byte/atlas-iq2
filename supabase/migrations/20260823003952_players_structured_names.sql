-- Structured name parts, added alongside full_name rather than replacing it.
--
-- NOT POPULATED. Existing rows keep full_name and gain four nulls. Splitting
-- a stored name is guesswork — "Mary Beth Van Dyke" has no reliable parse —
-- so a record becomes structured only when a person supplies the parts, via
-- intake or the roster form.
--
-- full_name STAYS NOT NULL and stays the display value. Once structured names
-- exist for a record, composeFullName() in lib/intake/normalize.js derives
-- full_name from them, so the four can never disagree. A record has either
-- structured names with a derived full_name, or a legacy full_name alone.
alter table public.players
  add column legal_first_name     text,
  add column preferred_first_name text,
  add column last_name            text,
  add column high_school          text;

comment on column public.players.legal_first_name is
  'Given name as it appears on documents. Null on records predating structured names; never derived by splitting full_name.';

comment on column public.players.preferred_first_name is
  'What the player is called. Takes precedence over legal_first_name when composing full_name.';

comment on column public.players.last_name is
  'Family name. Null on records predating structured names.';

comment on column public.players.high_school is
  'Current school. Recruiting context, and it distinguishes players who share a name.';
