"use client";

/**
 * Reads a spreadsheet into rows of cells — Excel or CSV, one entry point.
 *
 * CSV is parsed by hand, exactly as before. Excel loads SheetJS from a CDN at
 * the moment an .xlsx is chosen, so:
 *   - no new build dependency
 *   - no bundle cost for anyone who never imports
 *   - the CSV path is never touched, so Excel cannot break it
 *
 * If the CDN is unreachable the user is told to save as CSV, which still works.
 */

/**
 * SheetJS is bundled rather than loaded from a CDN.
 *
 * A runtime CDN request would send every importing user's IP address to
 * Cloudflare, making them a subprocessor we would have to disclose. The
 * dynamic import keeps the cost off anyone who never imports a spreadsheet,
 * while keeping the request inside the app.
 */
let sheetJsPromise = null;

function loadSheetJs() {
  if (!sheetJsPromise) sheetJsPromise = import("xlsx");
  return sheetJsPromise;
}

/** Splits one CSV line, honouring quoted fields containing commas. */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { out.push(cur); cur = ""; }
    else cur += c;
  }

  out.push(cur);
  return out.map((v) => v.trim());
}

/** CSV text to a grid of trimmed cells. Blank lines dropped. */
export function csvToGrid(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map(splitCsvLine);
}

/**
 * Reads any supported file into a grid.
 *
 * Returns { grid } or { error } — never throws, so a bad file is a message
 * rather than a broken screen.
 */
export async function readSpreadsheet(file) {
  const name = (file?.name ?? "").toLowerCase();

  if (name.endsWith(".csv") || file?.type === "text/csv") {
    const text = await file.text();
    const grid = csvToGrid(text);
    return grid.length ? { grid } : { error: "That file is empty." };
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    let XLSX;
    try {
      XLSX = await loadSheetJs();
    } catch {
      return {
        error: "Excel support couldn't load. Save the file as CSV and upload that instead.",
      };
    }

    try {
      const buffer = await file.arrayBuffer();
      // cellDates on the READ, not only on sheet_to_json. The conversion from
      // serial to Date happens here; passing it only to sheet_to_json left the
      // cells as numbers, which is how a real date of birth column arrived as
      // 40303 and was rejected as unreadable.
      const book = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) return { error: "That workbook has no sheets." };

      // header:1 gives raw rows rather than objects, so the same header
      // handling serves both formats.
      const grid = XLSX.utils
        /**
         * raw: false asks for each cell's DISPLAYED text — what the coach sees
         * in Excel. It is the only option that survives the line below.
         *
         * Two things were wrong. The serial never became a Date because
         * cellDates was passed here but not to read(). And even once it did,
         * the next line stringifies every cell, so a Date became
         * "Wed May 05 2010 00:00:00 GMT-0400 (Eastern Daylight Time)" — which
         * no date parser should be asked to read, and which carries a timezone
         * that can move the calendar day.
         *
         * The formatted text is "5/5/2010": exactly the value in the cell,
         * already in the format this product uses, and immune to both problems.
         */
        .sheet_to_json(sheet, { header: 1, blankrows: false, defval: "", raw: false, cellDates: true })
        .map((row) => row.map((c) => (c == null ? "" : String(c).trim())))
        .filter((row) => row.some((c) => c !== ""));

      return grid.length ? { grid } : { error: "That sheet is empty." };
    } catch {
      return { error: "That file couldn't be read. Try saving it as CSV." };
    }
  }

  return { error: "Upload a .xlsx or .csv file." };
}

/**
 * Builds a downloadable template.
 *
 * Excel is offered first because that is what coaches actually have open, but
 * both produce identical headers in identical order — a template that drifts
 * from the parser is worse than no template.
 */
export async function downloadTemplate(columns, filename, example = []) {
  try {
    const XLSX = await loadSheetJs();
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...(example.length ? [example] : [])]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Template");
    XLSX.writeFile(book, `${filename}.xlsx`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** CSV fallback, used when Excel generation is unavailable. */
export function csvTemplateHref(columns, example = []) {
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = [columns.map(esc).join(","), example.length ? example.map(esc).join(",") : ""]
    .filter(Boolean)
    .join("\n");
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`${body}\n`)}`;
}

/**
 * Writes a populated sheet, as opposed to an empty template.
 *
 * Every cell is forced to TEXT. Left to itself Excel turns a ZIP of 02138 into
 * 2138, reads a long phone number as a float, and re-interprets an ISO date
 * against the machine's locale — silently damaging exactly the fields a coach
 * is most likely to be handing to someone else.
 */
export async function downloadSheet(columns, rows, filename, sheetName = "Players") {
  try {
    const XLSX = await loadSheetJs();
    const aoa = [columns, ...rows];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);

    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        cell.t = "s";
        cell.v = cell.v === null || cell.v === undefined ? "" : String(cell.v);
        delete cell.z;
      }
    }

    // Enough width to read a name or an email without widening every column.
    sheet["!cols"] = columns.map((h) => ({ wch: Math.min(Math.max(h.length + 2, 12), 34) }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, sheetName);
    XLSX.writeFile(book, `${filename}.xlsx`);
    return { ok: true, rows: rows.length };
  } catch (e) {
    return { ok: false, error: e?.message ?? "Could not build the file." };
  }
}
