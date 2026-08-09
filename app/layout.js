import { Inter, Poppins } from "next/font/google";
import "./globals.css";

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

export const metadata = {
  title: "Season Tempo — Run the team. Set the pace.",
  description: "Tournaments, roster, facilities, games and dues in one place. Built for competitive travel softball.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
