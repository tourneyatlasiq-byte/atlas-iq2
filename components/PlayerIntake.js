"use client";

import { useMemo, useState } from "react";
import { readSpreadsheet } from "../lib/spreadsheet";
import { BY_KEY, isIgnored } from "../lib/intake/registry";
import { suggestMappings, applyMappings, looksLikeHeaders, columnLabels, selectableFields }
  from "../lib/intake/map-headers";
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
    hint: "Already in Season Tempo. Missing details can be filled in." },
  [CLASS.POSSIBLE]: { label: "Needs review", tone: "warn",
    hint: "Might be someone you already have. Please confirm." },
  [CLASS.CONFLICT]: { label: "Conflict", tone: "bad",
    hint: "The name matches, but other details disagree." },
  [CLASS.NEW]: { label: "New player", tone: "new",
    hint: "Nobody in Season Tempo matches this name." },
  [CLASS.INVALID]: { label: "Skipped", tone: "muted",
    hint: "No player name in this row." },
};

export function PlayerIntake({ existingPlayers = [], seasonName = "this season", onCancel }) {
  const [step, setStep] = useState("upload");
  const [file, setFile] = useState(null);
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  // The coach can declare the file has no header row; columns become A, B, C…
  const [hasHeaders, setHasHeaders] = useState(true);
  // Manual mapping wins over auto-detection: { [header]: fieldKey | "" }
  const [overrides, setOverrides] = useState({});

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

    const [first, ...rest] = result.grid;
    if (!first?.length) { setError("That file appears to be empty."); return; }

    // If the first row looks like data rather than headers, keep it as data
    // and label the columns instead. The coach can flip this either way.
    const headersDetected = looksLikeHeaders(first, rest[0] ?? []);
    const header = headersDetected ? first : columnLabels(first.length);
    const body = headersDetected ? rest : result.grid;
    if (body.length === 0) { setError("No player rows found."); return; }
    if (body.length > MAX_ROWS) {
      setError(`That file has ${body.length} rows. Split it into files of ${MAX_ROWS} or fewer.`);
      return;
    }

    const sug = suggestMappings(header);
    setFile({ name: f.name, rows: body.length, cols: header.length });
    setHasHeaders(headersDetected);
    setOverrides({});
    setGrid({ header, body, raw: result.grid, ...sug });
    setEnabled(new Set(sug.mappings.filter((m) => m.autoEnabled).map(keyOf)));
    setStep("map");
  }

  const keyOf = (m) => `${m.key}${m.index ?? ""}`;

  /* ---- Run the engine over every row ---------------------------------- */

  /**
   * Auto-detection is a convenience; the coach's choice is the authority.
   * A general importer cannot require anyone to name a column exactly
   * "Graduation Year".
   */
  const effective = useMemo(() => {
    if (!grid) return [];
    const out = [];
    for (const header of grid.header) {
      const over = overrides[header];
      if (over === "") continue;                       // explicitly not imported
      if (over) {
        const field = BY_KEY.get(over);
        if (!field) continue;
        const auto = grid.mappings.find((m) => m.header === header);
        out.push({ header, key: over, index: field.repeatable ? (auto?.index ?? 1) : null,
                   level: field.level, sensitive: field.sensitive, optIn: field.optIn,
                   pendingMigration: field.pendingMigration, autoEnabled: !field.optIn,
                   confidence: "manual" });
        continue;
      }
      const auto = grid.mappings.find((m) => m.header === header);
      if (auto) out.push(auto);
    }
    return out;
  }, [grid, overrides]);

  const analysed = useMemo(() => {
    if (!grid) return [];

    const active = effective.filter((m) => enabled.has(keyOf(m)));

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
        identity: identity[i] ?? null,
      });

      return { i, row, match, candidate, contactChecks, plan };
    });
  }, [grid, effective, enabled, existingPlayers, decisions, identity]);

  const stats = useMemo(() => summarize(analysed.map((a) => a.plan)), [analysed]);

  // Identity only. Field values are decided separately, in Review.
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
          file={file} grid={grid} effective={effective} enabled={enabled} setEnabled={setEnabled}
          overrides={overrides} setOverrides={setOverrides}
          hasHeaders={hasHeaders} onToggleHeaders={() => {
            const next = !hasHeaders;
            const header = next ? grid.raw[0] : columnLabels(grid.raw[0].length);
            const body = next ? grid.raw.slice(1) : grid.raw;
            const sug = suggestMappings(header);
            setHasHeaders(next);
            setOverrides({});
            setGrid({ header, body, raw: grid.raw, ...sug });
            setEnabled(new Set(sug.mappings.filter((m) => m.autoEnabled).map(keyOf)));
          }}
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

function MapFields({ file, grid, effective, enabled, setEnabled, overrides, setOverrides,
                    hasHeaders, onToggleHeaders, keyOf, onBack, onNext }) {
  const groups = selectableFields();

  const toggle = (m) => {
    const k = keyOf(m);
    const next = new Set(enabled);
    next.has(k) ? next.delete(k) : next.add(k);
    setEnabled(next);
  };

  const setField = (header, key) => {
    setOverrides({ ...overrides, [header]: key });
    if (key) {
      const field = BY_KEY.get(key);
      const next = new Set(enabled);
      // A field the coach chose deliberately is included, unless it is one of
      // the opt-in fields, which stay a separate decision.
      if (!field?.optIn) next.add(`${key}${field?.repeatable ? 1 : ""}`);
      setEnabled(next);
    }
  };

  const chosen = (header) => {
    if (overrides[header] !== undefined) return overrides[header];
    return effective.find((m) => m.header === header)?.key ?? "";
  };

  // Two or three values per column so a coach can tell what it holds — the
  // only reliable way to map "Column C" in a file with no headers.
  const sample = (i) => grid.body.slice(0, 3).map((r) => r[i]).filter(Boolean).slice(0, 2);

  const mappedCount = grid.header.filter((h) => chosen(h)).length;

  return (
    <div className="pi-panel">
      <h3>Map your columns</h3>
      <p className="pi-lede">
        <strong>{file.name}</strong> · {file.rows} rows · {file.cols} columns.
        We recognised {mappedCount}. Change anything that looks wrong.
      </p>

      <label className="pi-switch pi-headers">
        <input type="checkbox" checked={!hasHeaders} onChange={onToggleHeaders} />
        <span>My file doesn&rsquo;t have column headers</span>
      </label>

      <table className="pi-table">
        <thead>
          <tr><th>Spreadsheet column</th><th>Import as</th><th>Include</th></tr>
        </thead>
        <tbody>
          {grid.header.map((header, i) => {
            const key = chosen(header);
            const m = effective.find((x) => x.header === header);
            const field = key ? BY_KEY.get(key) : null;
            const on = m ? enabled.has(keyOf(m)) : false;
            const vals = sample(i);
            return (
              <tr key={header}>
                <td className="pi-col">
                  {header}
                  {vals.length > 0 && (
                    <span className="pi-sample">{vals.join(" · ")}</span>
                  )}
                </td>
                <td>
                  <select className="pi-select" value={key}
                          onChange={(e) => setField(header, e.target.value)}
                          aria-label={`Import ${header} as`}>
                    <option value="">Don&rsquo;t import</option>
                    {groups.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.fields.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {m?.index > 1 && <span className="pi-badge">Contact {m.index}</span>}
                  {field?.sensitive && <span className="pi-badge pi-badge-warn">Sensitive</span>}
                  {m?.confidence === "probable" && <span className="pi-badge">Best guess</span>}
                </td>
                <td>
                  {key ? (
                    <label className="pi-switch">
                      <input type="checkbox" checked={on} onChange={() => m && toggle(m)}
                             aria-label={`Include ${header}`} />
                      <span>{on ? "Included" : "Skipped"}</span>
                    </label>
                  ) : <span className="pi-note-quiet">Skipped</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {effective.some((m) => m.optIn) && (
        <p className="pi-note pi-note-warn">
          {effective.filter((m) => m.optIn).map((m) => BY_KEY.get(m.key).label).join(" and ")}{" "}
          is personal information about a minor. It stays switched off unless you choose to
          include it.
        </p>
      )}

      {(grid.contactGroups ?? []).length > 1 && (
        <p className="pi-note">
          We found {grid.contactGroups.length} sets of parent or guardian columns and will keep
          them separate.
        </p>
      )}

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
                  <Evidence label="In Season Tempo" p={a.candidate} />
                  <Evidence label="In your file" p={a.row} />
                </div>
              )}

              {needs && (
                <p className="pi-note pi-note-quiet">
                  This only says whether it is the same person. Any details that differ are
                  decided one at a time on the next screen.
                </p>
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

  const creating = analysed.filter((a) => a.plan.writes[0]?.op === "insert");
  const updating = analysed.filter((a) => a.plan.writes[0]?.op === "update");

  return (
    <div className="pi-panel">
      <h3>Review changes</h3>
      <p className="pi-lede">
        {creating.length} new · {updating.length} updated. Nothing is saved yet, and a blank
        cell in your file never erases what you already have.
      </p>

      <ul className="pi-rows">
        {analysed.map((a) => {
          // Every field the file had an opinion about, and what it becomes.
          const fills = a.plan.resolved.filter((r) => r.status === DIFF.FILL);
          const conflicts = a.plan.resolved.filter((r) => r.status === DIFF.CONFLICT);
          const kept = a.plan.resolved.filter((r) => r.status === DIFF.KEEP && r.existing);
          const same = a.plan.resolved.filter((r) => r.status === DIFF.SAME);
          if (!fills.length && !conflicts.length && !kept.length && !same.length
              && a.plan.writes[0]?.op !== "insert") return null;

          return (
            <li key={a.i} className="pi-row">
              <div className="pi-row-main">
                <span className="pi-row-name">{a.row.full_name}</span>
                <span className="pi-tag">
                  {a.plan.writes[0]?.op === "insert" ? "New player" : "Updating"}
                </span>
              </div>

              {conflicts.map((r) => (
                <div key={r.key} className="pi-conflict-row">
                  <p className="pi-conflict-q"><strong>{r.label}</strong></p>
                  <div className="pi-versus">
                    <div><span className="pi-versus-src">In Season Tempo</span>
                         <span className="pi-versus-val">{fmt(r.existing)}</span></div>
                    <div><span className="pi-versus-src">In your file</span>
                         <span className="pi-versus-val">{fmt(r.incoming)}</span></div>
                  </div>
                  <div className="pi-choice" role="group">
                    <button type="button"
                      className={`btn btn-secondary${decisions[a.i]?.[r.key] === "existing" ? " on" : ""}`}
                      onClick={() => decide(a.i, r.key, "existing")}>
                      Keep {fmt(r.existing)}
                    </button>
                    <button type="button"
                      className={`btn btn-secondary${decisions[a.i]?.[r.key] === "incoming" ? " on" : ""}`}
                      onClick={() => decide(a.i, r.key, "incoming")}>
                      Use {fmt(r.incoming)}
                    </button>
                  </div>
                  {r.decided && (
                    <p className="pi-outcome">Will be <strong>{fmt(r.chosen)}</strong></p>
                  )}
                </div>
              ))}

              <ul className="pi-diff">
                {fills.map((r) => (
                  <li key={r.key}>
                    <span className="pi-diff-verb pi-add">Adding</span>
                    <span>{r.label}</span>
                    <span className="pi-diff-val">{fmt(r.incoming)}</span>
                  </li>
                ))}
                {kept.length > 0 && (
                  <li className="pi-quiet">
                    <span className="pi-diff-verb pi-keep">Keeping</span>
                    <span>
                      {kept.length} existing value{kept.length === 1 ? "" : "s"} your file
                      left blank
                    </span>
                  </li>
                )}
                {same.length > 0 && (
                  <li className="pi-quiet">
                    <span className="pi-diff-verb pi-none">No change</span>
                    <span>
                      {same.length} field{same.length === 1 ? "" : "s"} already match
                    </span>
                  </li>
                )}
                {a.row.contacts?.length > 0 && (
                  <li>
                    <span className="pi-diff-verb pi-pend">Later</span>
                    <span>
                      {a.row.contacts.length} parent or guardian
                      {a.row.contacts.length === 1 ? "" : "s"}
                    </span>
                    <span className="pi-diff-val">saved once the update is finished</span>
                  </li>
                )}
              </ul>
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

const fmt = (v) =>
  v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v);

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
