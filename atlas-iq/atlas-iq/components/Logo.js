export function LogoMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d="M50 8 C46 8 43 11 41 16 L18 78 C16 83 20 87 25 84 L44 30 C45 26 47 22 50 20 Z" fill="currentColor" />
      <path d="M50 8 C54 8 57 11 59 16 L82 78 C84 83 80 87 75 84 L56 30 C55 26 53 22 50 20 Z" fill="currentColor" />
      <path d="M20 88 A32 32 0 0 1 80 88" stroke="#2E7D32" strokeWidth="14" strokeLinecap="round" fill="none" />
      <rect x="44" y="83" width="12" height="12" rx="2" fill="#F4B400" transform="rotate(45 50 89)" />
    </svg>
  );
}

/** Full lockup. `tone` switches the mark between the navy and on-navy contexts. */
export function LogoLockup({ size = 36, tone = "light" }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: tone === "light" ? "#FFFFFF" : "var(--navy)", display: "flex" }}>
        <LogoMark size={size} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span
          className="brand-word"
          style={{ color: tone === "light" ? "#FFFFFF" : "var(--navy)" }}
        >
          ATLAS <span>IQ</span>
        </span>
        <span className="brand-sub" style={{ color: tone === "light" ? "#8ba3c0" : "var(--slate)" }}>
          SOFTBALL
        </span>
      </span>
    </span>
  );
}
