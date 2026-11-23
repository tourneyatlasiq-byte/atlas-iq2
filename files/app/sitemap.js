// Only the public marketing and legal pages. Kept in step with PUBLIC_EXACT in lib/supabase/middleware.js.
const SITE = "https://seasontempo.com";

export default function sitemap() {
  const paths = ["/", "/product", "/about", "/privacy", "/terms"];
  return paths.map((p) => ({ url: `${SITE}${p === "/" ? "" : p}`, changeFrequency: "monthly", priority: p === "/" ? 1 : 0.6 }));
}
