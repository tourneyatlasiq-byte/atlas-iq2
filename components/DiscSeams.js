import { DISC_MOTIFS, SITE_SPORT } from "../lib/site-motif";

// Faint ball markings inside a Volt disc. Purely decorative: hidden from
// assistive technology, ignores the pointer, and sits inside the disc so it
// stays behind the product screenshots. No client script.
export default function DiscSeams({ sport = SITE_SPORT }) {
  const motif = DISC_MOTIFS[sport];
  if (!motif) return null;
  return (
    <svg className="sx-seams" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {motif.paths.map((d) => <path key={d} className="sx-seam" d={d} />)}
      {motif.stitch && motif.paths.map((d) => <path key={`s-${d}`} className="sx-stitch" d={d} />)}
    </svg>
  );
}
