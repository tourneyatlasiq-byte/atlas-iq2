/**
 * Sidebar navigation icons.
 *
 * Monochrome 1.5px line marks at 16px, matching the small line icons already
 * used elsewhere in the application. They inherit currentColor so the active
 * state needs no separate icon treatment.
 */
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
};

export function IconHome() {
  return (
    <svg {...base}>
      <path d="M2.5 6.5 8 2l5.5 4.5" />
      <path d="M3.75 7.5V13h8.5V7.5" />
    </svg>
  );
}

export function IconTournaments() {
  return (
    <svg {...base}>
      <path d="M4.5 2h7v3.5a3.5 3.5 0 0 1-7 0V2Z" />
      <path d="M4.5 3.25H2.5v1a2.5 2.5 0 0 0 2 2.45M11.5 3.25h2v1a2.5 2.5 0 0 1-2 2.45" />
      <path d="M8 9v2.5M5.75 14h4.5" />
    </svg>
  );
}

export function IconTeam() {
  return (
    <svg {...base}>
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13.5c0-2.2 1.8-3.75 4-3.75s4 1.55 4 3.75" />
      <path d="M10.75 4.1a2.25 2.25 0 0 1 0 4.3M11.75 10.4c1.4.5 2.25 1.7 2.25 3.1" />
    </svg>
  );
}

export function IconFacilities() {
  return (
    <svg {...base}>
      <path d="M2 13.5h12" />
      <path d="M3.5 13.5V6.75L8 3.5l4.5 3.25v6.75" />
      <path d="M6.5 13.5v-3h3v3" />
    </svg>
  );
}

export function IconFinance() {
  return (
    <svg {...base}>
      <path d="M8 2.5v11" />
      <path d="M10.5 5.1c-.5-.9-1.5-1.35-2.6-1.35-1.5 0-2.65.8-2.65 2.05 0 2.9 5.5 1.6 5.5 4.5 0 1.3-1.2 2.15-2.75 2.15-1.25 0-2.35-.5-2.85-1.5" />
    </svg>
  );
}

export function IconFiles() {
  return (
    <svg {...base}>
      <path d="M9 2H4.5v12h7V4.5L9 2Z" />
      <path d="M9 2v2.5h2.5" />
    </svg>
  );
}

export function IconContacts() {
  return (
    <svg {...base}>
      <circle cx="6.25" cy="5.75" r="2.4" />
      <path d="M2.25 13.5c0-2.3 1.8-3.9 4-3.9s4 1.6 4 3.9" />
      <path d="M11.5 6.25h2.25M11.5 8.75h2.25" />
    </svg>
  );
}
