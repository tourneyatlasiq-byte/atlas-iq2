/**
 * The invitation email (Phase 2B): HTML and plain text, built from the payload
 * invite_send_begin() returns. Same visual language as the Season Tempo sign-in
 * emails (Supabase templates, 2026-11).
 *
 * Every value that came from a person (organization, team, inviter name,
 * address) is escaped before it goes into HTML, and stripped of line breaks
 * before it goes into the subject.
 *
 * Deliberately absent: the owner's email address (only a real first name, and
 * only if they have one), anything about whether the recipient already has a
 * Season Tempo account, images, tracking pixels and tracking links.
 */
import { SITE_URL, INVITE_REPLY_TO } from "./config";

const ROLE_WORDS = {
  coach: "Coach",
  manager: "Manager",
};

const ROLE_MEANS =
  "you'll be able to view and update the team's schedule, roster, tournaments and money";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line, no control characters, sensible length — for subjects. */
function oneLine(value, max = 80) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** e.g. "November 24, 2026" in US Eastern time, where the beta teams are. */
export function formatExpiry(iso) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export function invitationLink(inviteId) {
  return `${SITE_URL}/invite/${encodeURIComponent(inviteId)}`;
}

export function buildInvitationEmail(p) {
  const team = oneLine(p.team_name || p.organization_name);
  const org = oneLine(p.organization_name);
  const inviter = p.inviter_first_name ? oneLine(p.inviter_first_name, 40) : null;
  const role = ROLE_WORDS[p.role] ?? "team member";
  const to = String(p.email ?? "").trim().toLowerCase();
  const link = invitationLink(p.invite_id);
  const expires = formatExpiry(p.expires_at);
  const showOrg = org && org !== team;

  const subject = inviter
    ? `${inviter} invited you to join ${team} on Season Tempo`
    : `You're invited to join ${team} on Season Tempo`;

  const who = inviter
    ? `${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(team)}</strong>${showOrg ? ` (${escapeHtml(org)})` : ""}`
    : `You've been invited to join <strong>${escapeHtml(team)}</strong>${showOrg ? ` (${escapeHtml(org)})` : ""}`;

  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F6F7F4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F6F7F4;">Join ${escapeHtml(team)} on Season Tempo as a ${role}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F7F4;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">

<tr><td align="center" style="padding:0 0 24px;font-family:${font};">
<span style="font-size:22px;line-height:1;color:#0B2341;letter-spacing:1px;">&#9679;&#9679;&#9679;</span><span style="font-size:22px;line-height:1;color:#F4B400;">&#9679;</span>
<span style="font-size:20px;line-height:1;font-weight:800;color:#0B2341;letter-spacing:1.5px;padding-left:8px;">SEASON&nbsp;TEMPO</span>
</td></tr>

<tr><td style="background-color:#FFFFFF;border:1px solid #DCE1E6;border-radius:12px;padding:32px 28px;font-family:${font};">

<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:#0B2341;">You're invited to Season Tempo</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3B4A5E;">${who} as a <strong>${role}</strong>.</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3B4A5E;">As a ${role}, ${ROLE_MEANS}.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" bgcolor="#1F65C4" style="border-radius:8px;">
<a href="${escapeHtml(link)}" target="_blank" style="display:block;padding:14px 20px;font-size:16px;line-height:1.25;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:8px;">Accept invitation</a>
</td></tr>
</table>

<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#3B4A5E;">This invitation was sent to <strong>${escapeHtml(to)}</strong> and only works when you sign in with that address. It expires on <strong>${escapeHtml(expires)}</strong>.</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
<tr><td style="border-top:1px solid #DCE1E6;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>

<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#5B697C;">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all;color:#3B4A5E;">${escapeHtml(link)}</span></p>
<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#5B697C;">If you weren't expecting this invitation, you can safely ignore this email.</p>

</td></tr>

<tr><td align="center" style="padding:24px 8px 0;font-family:${font};font-size:12px;line-height:1.6;color:#5B697C;">
Season Tempo &middot; The whole season, in one place.<br>
Need help? <a href="mailto:${INVITE_REPLY_TO}" style="color:#1F65C4;text-decoration:underline;">${INVITE_REPLY_TO}</a>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>
`;

  const textWho = inviter
    ? `${inviter} invited you to join ${team}${showOrg ? ` (${org})` : ""}`
    : `You've been invited to join ${team}${showOrg ? ` (${org})` : ""}`;

  const text = `You're invited to Season Tempo

${textWho} as a ${role}.
As a ${role}, ${ROLE_MEANS}.

Accept invitation:
${link}

This invitation was sent to ${to} and only works when you sign in with that address. It expires on ${expires}.

If you weren't expecting this invitation, you can safely ignore this email.

Season Tempo - The whole season, in one place.
Need help? ${INVITE_REPLY_TO}
`;

  return { subject, html, text, to };
}
