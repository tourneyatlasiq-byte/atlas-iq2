"use client";

/**
 * The print tip shared by the QAB reports (2026-11). Screen only: it lives in the
 * toolbar, which never prints.
 *
 * Chrome adds its own date and page title to every page when "Headers and footers"
 * is ticked, and it is ticked by default. A page cannot switch that off, so the
 * tip names the exact checkbox. Margins Default is what draws these reports' own
 * running header and page numbers.
 */
export const PRINT_HELP =
  "In the print dialog, set Margins to Default and untick Headers and footers (under More settings). Chrome otherwise adds its own date and page title to every page. This report's running header and page numbers are designed for the Default margin setting.";

export function PrintTips() {
  return (
    <details className="qp-tips">
      <summary>Before you print: turn off Headers and footers</summary>
      <p className="qp-help">{PRINT_HELP}</p>
    </details>
  );
}
