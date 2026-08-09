"use client";

import { useState, useMemo } from "react";

/**
 * Search-first picker.
 *
 * One interaction for every lookup in Season Tempo — contacts, facilities,
 * people. Three different picker styles would be three things to learn.
 *
 * The rule it exists to enforce: the create action is always reachable without
 * scrolling. The facility select had "+ Add a new facility…" as option 179,
 * which meant a coach scrolled the entire directory to reach the one thing
 * they already knew they needed.
 *
 * `suggested` puts likely matches above the search results — contacts already
 * used for the same tournament provider, for example. It never selects
 * anything on its own.
 */
export function SearchPicker({
  title,
  hint,
  placeholder,
  items,
  suggested = [],
  suggestedLabel,
  renderItem,
  onSelect,
  onCreate,
  createLabel,
  onCancel,
  emptyHint,
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (items ?? [])
      .filter((i) => (i.searchText ?? i.label ?? "").toLowerCase().includes(q))
      .slice(0, 10);
  }, [query, items]);

  const showSuggested = !query.trim() && suggested.length > 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-sheet picker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          {hint && <div className="page-sub">{hint}</div>}
        </div>

        <div className="modal-body">
          <div className="field">
            <input
              type="search"
              autoFocus
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={placeholder}
            />
          </div>

          {showSuggested && (
            <>
              <p className="picker-group">{suggestedLabel}</p>
              <div className="picker-list">
                {suggested.map((item) => (
                  <button key={item.id} type="button" className="picker-item" onClick={() => onSelect(item)}>
                    {renderItem(item)}
                  </button>
                ))}
              </div>
            </>
          )}

          {query.trim() && (
            <div className="picker-list">
              {matches.map((item) => (
                <button key={item.id} type="button" className="picker-item" onClick={() => onSelect(item)}>
                  {renderItem(item)}
                </button>
              ))}
              {matches.length === 0 && (
                <p className="field-note">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
              )}
            </div>
          )}

          {!query.trim() && !showSuggested && emptyHint && (
            <p className="field-note">{emptyHint}</p>
          )}
        </div>

        {/* Always reachable, whether there are no results, three, or a hundred. */}
        <div className="modal-foot modal-foot-sticky picker-foot">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onCreate(query.trim())}>
            {createLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
