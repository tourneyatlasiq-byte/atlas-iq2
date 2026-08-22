"use client";

import { useMemo, useState } from "react";
import { readSpreadsheet } from "../lib/spreadsheet";
import { BY_KEY, isIgnored } from "../lib/intake/registry";
import { suggestMappings, applyMappings } from "../lib/intake/map-headers";
import { normalizeValue, composeFullName } from "../lib/intake/normalize";
import { matchPlayer, matchContact, CLASS, CONTACT } from "../lib/intake/match";
import { buildRowPlan, summarize } from "../lib/intake/plan";
import { DIFF } from "../lib/intake/resolve";

/**
 * Player Intake — a preview workflow around the frozen A1–A8 engine.
 *
 * THIS COMPONENT CONTAINS NO INTAKE LOGIC. Every decision — how a header maps,
 * whether two people are the same, what counts as a conflict, what would be
 * written — comes from lib/intake. Duplicating any of that here would create a
 * second implementation that could disagree with the tested one.
 *
 * It also cannot write. There is no server action imported and no database
 * client reachable from this file; the final step is deliberately "Ready to
 * import" rather than "Import", because the database work does not exist yet
 * and a button that appeared to succeed would be a lie.
 *
 * The file itself never leaves the browser: readSpreadsheet() parses it here,
 * and only mapped values are ever held in memory.
 */

const MAX_ROWS = 200;

const STEPS = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Map fields" },
  { key: "match", label: "Match players" },
  { key: "review", label: "Review changes" },
  { key: "ready", label: "Ready to import" },
];

/* Coach-facing language. The engine's vocabulary stays in the engine. */
const MATCH_COPY = {
  [CLASS.CONFIDENT]: { label: "Matched", tone: "ok",
    hint: "Already on file. Missing details can be filled in." },
  [CLASS.POSSIBLE]: { label: "Needs review", tone: "warn",
    hint: "Might be someone you already have. Please confirm." },
  [CLASS.CONFLICT]: { label: "Conflict", tone: "bad",
    hint: "The name matches, but other details disagree." },
  [CLASS.NEW]: { label: "New player", tone: "new",
    hint: "Nobody on file matches this name." },
  [CLASS.INVALID]: { label: "Skipped", tone: "muted",
    hint: "No player name in this row." },
};

export function PlayerIntake({ existingPlayers = [], seasonName = "this season", onCancel }) {
  const [step, setStep] = useState("upload");
  const [file, setFile] = useState(null);
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  // Which mapped columns the coach has switched on. Opt-in fields start off;
  // sensitive fields are labelled but included, since a parent email is the
  // reason its column was mapped.
  const [enabled, setEnabled] = useState(new Set());
  // Row index -> "same" | "new"  for possible/conflict rows.
  const [identity, setIdentity] = useState({});
  // Row index -> { [fieldKey]: "existing" | "incoming" }
  const [decisions, setDecisions] = useState({});

  /* ---- A9: parse, client-side ---------------------------------------- */

  async function take(f) {
    setError(null);
    if (!f) return;

    const result = await readSpreadsheet(f);
    if (result.error) { setError(result.error); return; }

    const [header, ...body] = result.grid;
    if (!header?.length) { setError("That file has no header row."); return; }
    if (body.length === 0) { setError("No rows found below the header."); return; }
    if (body.length > MAX_ROWS) {
      setError(`That file has ${body.length} rows. Split it into files of ${MAX_ROWS} or fewer.`);
      return;
    }

    const sug = suggestMappings(header);
    setFile({ name: f.name, rows: body.length, cols: header.length });
    setGrid({ header, body, ...sug });
    setEnabled(new Set(sug.mappings.filter((m) => m.autoEnabled).map(keyOf)));
    setStep("map");
  }

  const keyOf = (m) => `${m.key}${m.index ?? ""}`;

  /* ---- Run the engine over every row ---------------------------------- */

  const analysed = useMemo(() => {
    if (!grid) return [];

    const active = grid.mappings.filter((m) => enabled.has(keyOf(m)));

    return grid.body.map((cells, i) => {
      const raw = Object.fromEntries(grid.header.map((h, c) => [h, cells[c] ?? ""]));
      const mapped = applyMappings(raw, active);

      // Normalise through the registry's declared type, never ad hoc.
      const row = { contacts: [] };
      for (const [k, v] of Object.entries(mapped)) {
        if (k === "contacts") continue;
        const field = BY_KEY.get(k);
        if (!field || isIgnored(k)) continue;
        row[k] = normalizeValue(field.type, v);
      }
      if (!row.full_name) {
        const composed = composeFullName(row);
        if (composed) row.full_name = composed;
      }
      row.contacts = (mapped.contacts ?? []).map((c) => ({
        ...c,
        full_name: normalizeValue("text", c.full_name),
        email: normalizeValue("email", c.email),
        phone: normalizeValue("phone", c.phone),
      }));

      const match = matchPlayer(row, existingPlayers);
      const candidate = match.candidate ?? null;

      // Contact ambiguity, per the frozen rules: email may identify, phone
      // alone may not.
      const contactChecks = row.contacts.map((c) =>
        ({ contact: c, ...matchContact(c, candidate?.contacts ?? []) }));

      const plan = buildRowPlan({
        row, match, existingPlayer: candidate,
        existingContacts: candidate?.contacts ?? [],
        decisions: decisions[i] ?? {},
      });

      return { i, row, match, candidate, contactChecks, plan };
    });
  }, [grid, enabled, existingPlayers, decisions]);

  const stats = useMemo(() => summarize(analysed.map((a) => a.plan)), [analysed]);

  const needsIdentity = analysed.filter(
    (a) => (a.match.classification === CLASS.POSSIBLE || a.match.classification === CLASS.CONFLICT)
      && !identity[a.i]);

  const needsDecision = analysed.filter((a) =>
    a.plan.blockers.some((b) => b.startsWith("undecided")));

  const ambiguousContacts = analysed.flatMap((a) =>
    a.contactChecks.filter((c) => c.action === CONTACT.REVIEW).map((c) => ({ row: a, check: c })));

  const pendingRows = analysed.filter((a) => a.plan.pending.length > 0);
  const blockedByData = needsIdentity.length + needsDecision.length;

  /* ---- Render ---------------------------------------------------------- */

  return (
    <div className="pi">
      <ol className="pi-steps" aria-label="Import progress">
        {STEPS.map((s, n) => (
          <li key={s.key} className={`pi-step${s.key === step ? " on" : ""}`}
              aria-current={s.key === step ? "step" : undefined}>
            <span className="pi-step-n">{n + 1}</span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {step === "upload" && (
        <Upload dragging={dragging} setDragging={setDragging} onFile={take} onCancel={onCancel} />
      )}

      {step === "map" && grid && (
        <MapFields
          file={file} grid={grid} enabled={enabled} setEnabled={setEnabled}
          keyOf={keyOf} onBack={() => { setStep("upload"); setGrid(null); setFile(null); }}
          onNext={() => setStep("match")}
        />
      )}

      {step === "match" && (
        <MatchPlayers
          analysed={analysed} identity={identity} setIdentity={setIdentity}
          onBack={() => setStep("map")} onNext={() => setStep("review")}
          outstanding={needsIdentity.length}
        />
      )}

      {step === "review" && (
        <ReviewChanges
          analysed={analysed} decisions={decisions} setDecisions={setDecisions}
          ambiguousContacts={ambiguousContacts} outstanding={needsDecision.length}
          onBack={() => setStep("match")} onNext={() => setStep("ready")}
        />
      )}

      {step === "ready" && (
        <Ready
          stats={stats} analysed={analysed} pendingRows={pendingRows}
          blocked={blockedByData} seasonName={seasonName}
          onBack={() => setStep("review")} onCancel={onCancel}
        />
      )}
    </div>
  );
}

/* ---- Step 1 ------------------------------------------------------------ */

function Upload({ dragging, setDragging, onFile, onCancel }) {
  return (
    <div className="pi-panel">
      <h3>Upload your roster</h3>
      <p className="pi-lede">
        An Excel or CSV file, up to {MAX_ROWS} players. Your file is read on this device and is
        never uploaded.
      </p>

      <label
        className={`pi-drop${dragging ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
      >
        <input type="file" accept=".xlsx,.xls,.csv"
               onChange={(e) => onFile(e.target.files?.[0])} />
        <span className="pi-drop-main">Drop a file here, or choose one</span>
        <span className="pi-drop-sub">.xlsx or .csv</span>
      </label>

      <div className="pi-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ---- Step 2 ------------------------------------------------------------ */

function MapFields({ file, grid, enabled, setEnabled, keyOf, onBack, onNext }) {
  const toggle = (m) => {
    const k = keyOf(m);
    const next = new Set(enabled);
    next.has(k) ? next.delete(k) : next.add(k);
    setEnabled(next);
  };

  const groups = grid.contactGroups ?? [];
  // Two representative rows are enough to confirm the right file. Showing the
  // whole sheet would put every family's details on screen for no benefit.
  const preview = grid.body.slice(0, 2);
  const previewCols = grid.header.slice(0, 4);

  return (
    <div className="pi-panel">
      <h3>Map your columns</h3>
      <p className="pi-lede">
        <strong>{file.name}</strong> · {file.rows} rows · {file.cols} columns.
        We recognised {grid.mappings.length} of them.
      </p>

      <table className="pi-table">
        <thead>
          <tr><th>Your column</th><th>Season Tempo field</th><th>Include</th></tr>
        </thead>
        <tbody>
          {grid.mappings.map((m) => {
            const field = BY_KEY.get(m.key);
            const on = enabled.has(keyOf(m));
            return (
              <tr key={m.header}>
                <td className="pi-col">{m.header}</td>
                <td>
                  {field.label}
                  {m.index ? <span className="pi-badge">Contact {m.index}</span> : null}
                  {m.sensitive && <span className="pi-badge pi-badge-warn">Sensitive</span>}
                  {m.confidence === "probable" && <span className="pi-badge">Best guess</span>}
                </td>
                <td>
                  <label className="pi-switch">
                    <input type="checkbox" checked={on} onChange={() => toggle(m)}
                           aria-label={`Include ${m.header}`} />
                    <span>{on ? "Included" : "Skipped"}</span>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {grid.mappings.some((m) => m.optIn) && (
        <p className="pi-note pi-note-warn">
          {grid.mappings.filter((m) => m.optIn).map((m) => BY_KEY.get(m.key).label).join(" and ")}{" "}
          is personal information about a minor. It stays switched off unless you choose to
          include it.
        </p>
      )}

      {groups.length > 1 && (
        <p className="pi-note">
          We found {groups.length} sets of parent or guardian columns and will keep them separate.
        </p>
      )}

      {grid.ignored.length > 0 && (
        <p className="pi-note pi-note-quiet">
          Not imported: {grid.ignored.map((i) => i.header).join(", ")}.
        </p>
      )}

      {grid.unmapped.length > 0 && (
        <p className="pi-note">
          We didn&rsquo;t recognise: {grid.unmapped.join(", ")}. These will be skipped.
        </p>
      )}

      <details className="pi-preview">
        <summary>Check this is the right file</summary>
        <table className="pi-table pi-table-tight">
          <thead><tr>{previewCols.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {preview.map((r, i) => (
              <tr key={i}>{previewCols.map((_, c) => <td key={c}>{r[c]}</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="pi-note pi-note-quiet">Showing the first rows and columns only.</p>
      </details>

      <div className="pi-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-primary" onClick={onNext}>Match players</button>
      </div>
    </div>
  );
}

/* ---- Step 3 ------------------------------------------------------------ */

function MatchPlayers({ analysed, identity, setIdentity, onBack, onNext, outstanding }) {
  const choose = (i, v) => setIdentity({ ...identity, [i]: v });

  const counts = analysed.reduce((acc, a) => {
    acc[a.match.classification] = (acc[a.match.classification] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="pi-panel">
      <h3>Match players</h3>
      <p className="pi-lede">
        {Object.entries(counts)
          .map(([k, n]) => `${n} ${MATCH_COPY[k].label.toLowerCase()}`)
          .join(" · ")}
      </p>

      <ul className="pi-rows">
        {analysed.map((a) => {
          const copy = MATCH_COPY[a.match.classification];
          const needs = a.match.classification === CLASS.POSSIBLE
            || a.match.classification === CLASS.CONFLICT;
          return (
            <li key={a.i} className={`pi-row pi-${copy.tone}`}>
              <div className="pi-row-main">
                <span className="pi-row-name">{a.row.full_name || "(no name)"}</span>
                <span className="pi-tag">{copy.label}</span>
              </div>
              <p className="pi-row-hint">{copy.hint}</p>

              {/* Only the fields that actually informed the decision. No
                  unrelated player data, and never a jersey number. */}
              {needs && a.candidate && (
                <div className="pi-compare">
                  <Evidence label="On file" p={a.candidate} />
                  <Evidence label="In your file" p={a.row} />
                </div>
              )}

              {needs && (
                <div className="pi-choice" role="group" aria-label={`Decide ${a.row.full_name}`}>
                  <button type="button"
                    className={`btn btn-secondary${identity[a.i] === "same" ? " on" : ""}`}
                    onClick={() => choose(a.i, "same")}>Same player</button>
                  <button type="button"
                    className={`btn btn-secondary${identity[a.i] === "new" ? " on" : ""}`}
                    onClick={() => choose(a.i, "new")}>Different player</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="pi-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={outstanding > 0}>
          {outstanding > 0 ? `${outstanding} still to confirm` : "Review changes"}
        </button>
      </div>
    </div>
  );
}

/** Corroborating detail only — never a jersey number, never unrelated data. */
function Evidence({ label, p }) {
  const bits = [];
  if (p.grad_year) bits.push(["Graduation year", p.grad_year]);
  if (p.date_of_birth) bits.push(["Date of birth", p.date_of_birth]);
  const email = p.contacts?.[0]?.email ?? p.parent_email;
  if (email) bits.push(["Contact email", email]);
  return (
    <div className="pi-evidence">
      <p className="pi-evidence-label">{label}</p>
      {bits.length === 0
        ? <p className="pi-note pi-note-quiet">Nothing else to compare</p>
        : <dl>{bits.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>))}</dl>}
    </div>
  );
}

/* ---- Step 4 ------------------------------------------------------------ */

function ReviewChanges({ analysed, decisions, setDecisions, ambiguousContacts, outstanding, onBack, onNext }) {
  const decide = (i, key, choice) =>
    setDecisions({ ...decisions, [i]: { ...(decisions[i] ?? {}), [key]: choice } });

  const rowsWithChanges = analysed.filter((a) =>
    a.plan.writes.some((w) => Object.keys(w.values ?? {}).length));

  return (
    <div className="pi-panel">
      <h3>Review changes</h3>
      <p className="pi-lede">
        Nothing is saved yet. Blank cells in your file never erase what you already have.
      </p>

      <ul className="pi-rows">
        {rowsWithChanges.map((a) => {
          const conflicts = a.plan.blockers.filter((b) => b.startsWith("undecided"));
          return (
            <li key={a.i} className="pi-row">
              <div className="pi-row-main">
                <span className="pi-row-name">{a.row.full_name}</span>
                <span className="pi-tag">{MATCH_COPY[a.match.classification].label}</span>
              </div>

              <ul className="pi-diff">
                {a.plan.writes.flatMap((w) =>
                  Object.entries(w.values ?? {}).map(([k, v]) => (
                    <li key={`${w.table}-${k}`}>
                      <span className="pi-diff-verb">Adding</span>
                      <span>{BY_KEY.get(k)?.label ?? k}</span>
                      <span className="pi-diff-val">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                    </li>
                  )))}
              </ul>

              {conflicts.length > 0 && (
                <ConflictRow a={a} decisions={decisions[a.i] ?? {}} decide={decide} />
              )}
            </li>
          );
        })}
      </ul>

      {ambiguousContacts.length > 0 && (
        <div className="pi-note pi-note-warn">
          <strong>{ambiguousContacts.length} contact{ambiguousContacts.length === 1 ? "" : "s"} need a look.</strong>{" "}
          A shared phone number isn&rsquo;t enough to be sure two entries are the same person, so
          we won&rsquo;t merge or duplicate them without you.
          <ul className="pi-sub">
            {ambiguousContacts.map(({ row, check }, n) => (
              <li key={n}>
                {check.contact.full_name ?? "A contact"} for {row.row.full_name} — {check.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pi-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={outstanding > 0}>
          {outstanding > 0 ? `${outstanding} decision${outstanding === 1 ? "" : "s"} needed` : "Continue"}
        </button>
      </div>
    </div>
  );
}

function ConflictRow({ a, decisions, decide }) {
  const keys = a.plan.blockers
    .filter((b) => b.startsWith("undecided"))
    .flatMap((b) => b.replace("undecided conflicts: ", "").split(", "));

  return (
    <div className="pi-conflict">
      {keys.map((k) => (
        <div key={k} className="pi-conflict-row">
          <p className="pi-conflict-q">
            <strong>{BY_KEY.get(k)?.label ?? k}</strong> doesn&rsquo;t match. Which is right?
          </p>
          <div className="pi-choice" role="group">
            <button type="button"
              className={`btn btn-secondary${decisions[k] === "existing" ? " on" : ""}`}
              onClick={() => decide(a.i, k, "existing")}>Keep what we have</button>
            <button type="button"
              className={`btn btn-secondary${decisions[k] === "incoming" ? " on" : ""}`}
              onClick={() => decide(a.i, k, "incoming")}>Use the file</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- Step 5 ------------------------------------------------------------ */

function Ready({ stats, analysed, pendingRows, blocked, seasonName, onBack, onCancel }) {
  const creatable = analysed.filter((a) => a.match.classification === CLASS.NEW).length;
  const updatable = analysed.filter((a) => a.match.classification === CLASS.CONFIDENT).length;

  return (
    <div className="pi-panel">
      <h3>Ready to import</h3>
      <p className="pi-lede">
        {analysed.length} rows for {seasonName}: {updatable} already on file, {creatable} new.
      </p>

      <dl className="pi-summary">
        <div><dt>Players to add</dt><dd>{creatable}</dd></div>
        <div><dt>Players to update</dt><dd>{updatable}</dd></div>
        <div><dt>Still needing a decision</dt><dd>{blocked}</dd></div>
      </dl>

      {/* Plain language. The coach is not told about migrations, tables or
          pending destinations — only that some information cannot be saved
          yet and nothing will be lost. */}
      {pendingRows.length > 0 && (
        <div className="alert alert-warning">
          <strong>Some of this information can&rsquo;t be saved yet.</strong> Separate first and
          last names, high school, and parent or guardian details are part of a Season Tempo
          update that isn&rsquo;t finished. Everything else is ready and nothing here is lost.
        </div>
      )}

      <div className="alert alert-info">
        <strong>Importing isn&rsquo;t switched on yet.</strong> This step checks your file and
        shows exactly what would change. Saving to your roster becomes available once the
        Season Tempo update is complete.
      </div>

      <div className="pi-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-primary" disabled aria-disabled="true"
                title="Available once the Season Tempo update is complete">
          Import {stats.rows} players
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}
