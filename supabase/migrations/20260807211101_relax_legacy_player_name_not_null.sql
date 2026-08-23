-- Legacy column retained (not dropped), but no longer required.
-- New records link via player_id only. Reversible with SET NOT NULL.
alter table player_payments alter column player_name drop not null;
