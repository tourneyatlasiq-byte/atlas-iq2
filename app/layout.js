import { Inter, Poppins, Schibsted_Grotesk, Inter_Tight } from "next/font/google";
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
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

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

export const metadata = {
  title: "Season Tempo — Run the team. Set the pace.",
  description: "Tournaments, roster, facilities, games and dues in one place. Built for competitive travel softball.",
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: a script in the app shell adds the "volt" class
    // before first paint on screens that use the Volt system.
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} ${schibsted.variable} ${interTight.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
