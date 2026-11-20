/* Sign-in email templates (supabase/email-templates). They are not deployed by the app; this keeps the files
   honest until they are pasted into the Supabase dashboard: Supabase's own variables are present, the support
   address matches the one the app uses, and nothing external is loaded. */
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
let bad = 0; const t = (n, c) => { console.log((c ? "ok  " : "FAIL") + "  " + n); if (!c) bad++; };
const legal = fs.readFileSync(path.join(ROOT, "lib/legal.js"), "utf8");
const SUPPORT = /SUPPORT_EMAIL\s*=\s*"([^"]+)"/.exec(legal)[1];
for (const f of ["magic-link", "confirm-signup"]) {
  const h = fs.readFileSync(path.join(ROOT, `supabase/email-templates/${f}.html`), "utf8");
  console.log(f);
  t("button links to {{ .ConfirmationURL }}", /<a href="\{\{ \.ConfirmationURL \}\}"/.test(h));
  t("the same link is printed as a fallback", (h.match(/\{\{ \.ConfirmationURL \}\}/g) || []).length === 2);
  t("the sign-in code {{ .Token }} appears once, in the code box", (h.match(/\{\{ \.Token \}\}/g) || []).length === 1 && /letter-spacing:6px[^>]*>\{\{ \.Token \}\}</.test(h));
  t("{{ .Email }} names the recipient", /\{\{ \.Email \}\}/.test(h));
  t("no other template variables", [...h.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].every((m) => [".ConfirmationURL", ".Token", ".Email"].includes(m[1])));
  t(`support address is the app's (${SUPPORT}), as a mailto link`, h.includes(`mailto:${SUPPORT}`) && h.includes(`>${SUPPORT}</a>`));
  t("the removed sentence is gone", !/Nobody can sign in/.test(h));
  t("no images, scripts, external styles or tracking", !/<img|<script|<link|url\(|http:\/\//i.test(h));
}
const inv = fs.readFileSync(path.join(ROOT, "lib/email/config.js"), "utf8");
t("the invitation reply-to uses the same support address", inv.includes(`INVITE_REPLY_TO = "${SUPPORT}"`));
console.log(bad ? `\n${bad} check(s) failed` : "\nAll email template checks passed");
process.exit(bad ? 1 : 0);
