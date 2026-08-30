-- An intentionally dues-exempt player.
--
-- A coach's own child, a player on scholarship: some players are deliberately
-- not charged. Until now there was no way to say so.
--
-- The two alternatives both lie:
--
--   Deleting the obligation shows the player under "Dues not set", which is
--   indistinguishable from an oversight -- the coach is chased forever by a
--   number that is supposed to be zero.
--
--   Setting initial_cost to 0 shows a balance of zero, and the status logic
--   reads balance <= 0 as "Paid in Full". A player who was never charged is
--   reported as having paid, which is not the same fact.
--
-- So exemption is stated, not inferred. `exempt` is its own column, default
-- false, and it is reversible: clearing it and setting an amount puts the
-- player back among those who owe.
--
-- initial_cost stays NOT NULL and is 0 for an exempt player. The amount is
-- meaningless while exempt is true, and every total filters on the flag rather
-- than on the number.
alter table player_payments
  add column if not exists exempt boolean not null default false;

comment on column player_payments.exempt is
  'The organization has decided this player does not owe dues this season. Distinct from having no obligation record (never set up) and from owing 0 (charged nothing). Reversible. Totals and allocation exclude exempt players.';

-- Exemption and money are contradictory. A player who has paid cannot be
-- exempt, and an exempt player cannot carry an amount: either would produce a
-- season total that does not mean what it says.
alter table player_payments drop constraint if exists player_payments_exempt_zero;
alter table player_payments add constraint player_payments_exempt_zero
  check (not exempt or initial_cost = 0);

-- Finding who owes is the common read.
create index if not exists idx_player_payments_season_exempt
  on player_payments (season_id, exempt);
