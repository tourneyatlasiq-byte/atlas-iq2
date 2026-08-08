"use client";

import { useTransition } from "react";
import { returnToCurrentSeason } from "../lib/actions/seasons";

/**
 * Says plainly which season you're looking at when it isn't the current one.
 *
 * Past and future read differently on purpose: a past season is finished and
 * read-only; a future season is a plan you can still build. Treating them the
 * same would either lock planning or imply history is editable.
 */
export function SeasonBanner({ phase, seasonName, currentSeasonName }) {
  const [pending, startTransition] = useTransition();

  if (phase === "current") return null;

  const past = phase === "past";

  return (
    <div className={`season-banner${past ? " season-banner-past" : " season-banner-future"}`}>
      <div className="season-banner-text">
        <strong>
          {past ? `Viewing ${seasonName} season` : `Planning ${seasonName}`}
        </strong>
        <span>
          {past
            ? "Past seasons are read-only."
            : `Your current season is still ${currentSeasonName ?? "unchanged"}. You can build this season now.`}
        </span>
      </div>

      <button
        className="btn btn-secondary"
        disabled={pending}
        onClick={() => startTransition(async () => { await returnToCurrentSeason(); })}
      >
        {pending ? "Switching…" : "Return to current season"}
      </button>
    </div>
  );
}
