import { Schibsted_Grotesk, Inter_Tight } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import "./volt.css";

/**
 * Fonts are self-hosted at build time rather than fetched from Google.
 *
 * A stylesheet link to fonts.googleapis.com sends every visitor's IP address
 * to Google on page load, which would make Google a subprocessor we would have
 * to disclose. next/font removes that request entirely.
 */
/* Volt design system (approved 2026-11-18). Applied screen by screen while it
   is reviewed; see app/volt.css. Geist Mono is not in this Next.js version's
   Google list, so its one weight ships with the app (SIL Open Font License,
   app/fonts/GeistMono-LICENSE.txt). */
const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-schibsted",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter-tight",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Medium.woff2",
  weight: "500",
  variable: "--font-geist-mono",
  display: "swap",
});

const DESCRIPTION =
  "Season Tempo keeps tournaments, lineups, money and performance for your travel softball team in one place.";

export const metadata = {
  metadataBase: new URL("https://seasontempo.com"),
  title: { default: "Season Tempo: The whole season, in one place.", template: "%s | Season Tempo" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Season Tempo",
    title: "Season Tempo: The whole season, in one place.",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Season Tempo: The whole season, in one place.", description: DESCRIPTION },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${schibsted.variable} ${interTight.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
