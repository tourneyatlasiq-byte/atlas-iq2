-- These rows were seeded so the /review page had something to render. They
-- point at storage paths with no file behind them, so every download fails.
-- Harmless while Files was untested; misleading now that real uploads work.
delete from documents where notes like '[demo]%';
