// Public pages may be indexed. The signed-in application never should be.
const SITE = "https://www.seasontempo.com";

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/product", "/about", "/privacy", "/terms"],
        disallow: [
          "/dashboard", "/tournaments", "/team", "/locations", "/finance", "/performance",
          "/reports", "/files", "/contacts", "/settings", "/help", "/welcome", "/invite", "/login", "/auth",
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
