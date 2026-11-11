-- games_04: Showcase becomes a selectable game type (2026-11).
--
-- Replaces the allowed-values check on games.game_type with the same list plus
-- 'Showcase', in the product's display order. Nothing else changes: no existing
-- game is touched (every current value remains valid), and game type is never
-- used in any calculation — W-L-T and QAB statistics treat every type alike.
alter table public.games drop constraint games_game_type_check;

alter table public.games add constraint games_game_type_check
  check (game_type is null or game_type = any (array[
    'Pool', 'Bracket', 'Championship', 'Showcase', 'Friendly', 'Scrimmage'
  ]));
