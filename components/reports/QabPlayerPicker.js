"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { withFrom, reportBack } from "../../lib/report-back";
import { playerChoiceLabel, filterPlayerChoices } from "../../lib/qab-player-rules";

export const QAB_PLAYER_PATH = "/reports/qab-player";

/** The report address for one player. Season scope; the origin is kept. */
export function playerReportHref(playerId, from = null) {
  return withFrom(`${QAB_PLAYER_PATH}?player=${encodeURIComponent(playerId)}`, from);
}

const GROUPS = [
  ["active", "Active players"],
  ["inactive", "Inactive players"],
  ["pickup", "Pickup players"],
];

/**
 * "Choose a player" for the Individual Player QAB Report (2026-11).
 *
 * Opened from the Reports hub. A search box with the list underneath: type any
 * part of a name to narrow it, or open the list and pick. The choices are
 * already limited to players the report will open (see groupPlayerChoices) and
 * stay grouped as Active, Inactive and Pickup, so an inactive or pickup player
 * is found by name without hunting. Choosing a name does nothing else: opening
 * is an explicit Open report press, and a second press while the report loads
 * is ignored. The report keeps its own Season / Tournament control.
 *
 * Keyboard: arrows move through matches, Enter chooses, Escape closes the list.
 * The list is inline (not a floating layer), so it never covers the Open
 * button or runs off a phone screen.
 *
 * Plain strings and arrays only cross from the server page.
 */
export function QabPlayerPicker({ choices, from = null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // { id, name }
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const back = reportBack(from);

  const total = GROUPS.reduce((n, [k]) => n + (choices?.[k]?.length ?? 0), 0);
  const shown = useMemo(() => filterPlayerChoices(choices, query), [choices, query]);
  const flat = useMemo(() => GROUPS.flatMap(([k]) => shown[k]), [shown]);
  const optId = (i) => `${uid}-opt-${i}`;

  function choose(c) {
    setSelected({ id: c.id, name: c.name });
    setQuery(c.name);
    setListOpen(false);
    setActive(-1);
  }
  function onType(e) {
    setQuery(e.target.value);
    setSelected(null);
    setListOpen(true);
    setActive(0);
  }
  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!listOpen) { setListOpen(true); setActive(flat.length ? 0 : -1); return; }
      if (!flat.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      if (listOpen && active >= 0 && flat[active]) { e.preventDefault(); choose(flat[active]); }
    } else if (e.key === "Escape") {
      if (listOpen) { e.preventDefault(); setListOpen(false); }
    }
  }
  function onBlur(e) {
    if (!rootRef.current?.contains(e.relatedTarget)) setListOpen(false);
  }
  function open(e) {
    e.preventDefault();
    if (!selected || pending) return;
    startTransition(() => router.push(playerReportHref(selected.id, from)));
  }

  let n = -1;
  return (
    <div className="rpt-shell">
      <div className="rpt-bar rpt-no-print">
        <div className="rpt-tb-head">
          <Link href={back.href} className="rpt-tb-back">&larr; {back.label}</Link>
          <p className="rpt-tb-name">Individual Player QAB Report</p>
        </div>

        {total === 0 ? (
          <div className="rpt-detail">
            <p className="qp-picker-empty">
              No players have been added to this season yet. Add players to the roster, then come back here.
            </p>
          </div>
        ) : (
          <form className="rpt-detail qp-picker" onSubmit={open} aria-busy={pending || undefined}>
            <div className="qp-picker-find" ref={rootRef} onBlur={onBlur}>
              <label className="rpt-detail-label" htmlFor={`${uid}-input`}>Player</label>
              <input
                id={`${uid}-input`}
                className="qab-scope-select qp-picker-input"
                type="text"
                role="combobox"
                aria-expanded={listOpen}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={listOpen && active >= 0 ? optId(active) : undefined}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Search by name"
                value={query}
                disabled={pending}
                onChange={onType}
                onFocus={() => setListOpen(true)}
                onClick={() => setListOpen(true)}
                onKeyDown={onKeyDown}
              />
              {listOpen && (
                <div id={listId} className="qp-picker-list" role="listbox" aria-label="Players">
                  {flat.length === 0 && <p className="qp-picker-none" role="status">No player matches &ldquo;{query.trim()}&rdquo;.</p>}
                  {GROUPS.map(([key, label]) =>
                    shown[key].length > 0 ? (
                      <div key={key} role="group" aria-label={label}>
                        <p className="qp-picker-group" aria-hidden="true">{label}</p>
                        {shown[key].map((c) => {
                          n += 1;
                          const i = n;
                          return (
                            <div
                              key={c.id}
                              id={optId(i)}
                              role="option"
                              aria-selected={selected?.id === c.id}
                              className={`qp-picker-opt${i === active ? " is-active" : ""}${selected?.id === c.id ? " is-selected" : ""}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => choose(c)}
                              onMouseMove={() => active !== i && setActive(i)}
                            >
                              {playerChoiceLabel(c)}
                            </div>
                          );
                        })}
                      </div>
                    ) : null
                  )}
                </div>
              )}
            </div>
            <button type="submit" className="rpt-btn rpt-btn-primary qp-picker-go" disabled={!selected || pending}>
              {pending ? "Opening\u2026" : "Open report"}
            </button>
            <p className="qp-picker-hint">
              Shows one player&rsquo;s quality at-bats for the season. You can switch to a single tournament once it opens.
              Inactive and pickup players are included when they have at-bats.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
