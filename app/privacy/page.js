import Link from "next/link";
import { LogoLockup } from "../../components/SeasonTempoLogo";
import {
  LEGAL_ENTITY, PRODUCT, PRIVACY_VERSION, EFFECTIVE_DATE,
  PRIVACY_EMAIL, SUPPORT_EMAIL, SUBPROCESSORS,
} from "../../lib/legal";
import "../home.css";

export const metadata = {
  title: "Privacy Policy — Season Tempo",
  description: "How Season Tempo handles the information you enter.",
};

/**
 * Every statement here is traceable to something verified in the application.
 *
 * Deliberately absent: claims of COPPA, GDPR or CCPA compliance, invented
 * retention periods, encryption specifics, and security certifications. If it
 * could not be confirmed from the system, it is not in this document.
 */
export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <header className="mk-header">
        <div className="mk-wrap mk-header-inner">
          <Link href="/" className="mk-logo" aria-label="Season Tempo home">
            <LogoLockup size={30} tone="navy" wordSize={22} />
          </Link>
          <nav className="mk-nav">
            <Link href="/terms">Terms</Link>
            <Link href="/">Home</Link>
          </nav>
        </div>
      </header>

      <main className="legal-wrap">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">
          Version {PRIVACY_VERSION} · Effective {EFFECTIVE_DATE}
        </p>

        <p className="legal-lede">
          {PRODUCT} is operated by {LEGAL_ENTITY}. This policy explains what information the
          service holds, who else can see it, and how to have it removed. It describes the
          service as it works today, during early access.
        </p>

        <h2>Who this service is for</h2>
        <p>
          {PRODUCT} is intended for adults — coaches, team managers and other authorized
          people running a travel sports organization. <strong>It is not intended for children
          to create accounts or submit information.</strong> Players cannot sign in, upload
          anything, or enter their own details. Every piece of information about a player is
          entered by an adult account holder.
        </p>
        <p>
          If you are an adult entering information about a child, you are responsible for
          having the right to share it.
        </p>

        <h2>What we hold</h2>

        <h3>Your account</h3>
        <p>
          Your email address, the name you enter, your role, and the organization you belong
          to. Sign-in is by emailed link, so no password is stored.
        </p>

        <h3>Information you enter about your organization</h3>
        <p>
          Team and season names, players and staff, tournaments, games and results, facilities
          and your notes about them, budgets and expenses, and what each player owes and has
          paid.
        </p>

        <h3>Information about players</h3>
        <p>
          A player record can include a name, date of birth, graduation year, jersey number,
          positions, uniform sizes, contact details, and a parent or guardian&rsquo;s name,
          email and phone number. Which of these you provide is entirely your choice — only a
          name is required.
        </p>

        <h3>Files you upload</h3>
        <p>
          Documents you attach to your team, a player or a tournament, along with the file
          name, type and size, and who uploaded it.
        </p>
        <p>
          <strong>Please don&rsquo;t upload highly sensitive information.</strong> {PRODUCT} is
          not designed to store Social Security numbers, birth certificates, passports or other
          government identification, medical records, or card and bank details. There is no
          feature intended to hold them.
        </p>

        <h3>Payments</h3>
        <p>
          {PRODUCT} records what a player owes and what has been paid, as a number you enter.
          <strong> It does not process payments and never sees a card or bank account
          number.</strong> There is no payment processor connected to the service.
        </p>

        <h3>Technical information</h3>
        <p>
          A cookie keeps you signed in, and another remembers which season you are viewing. The
          application does not run analytics, advertising or tracking of any kind, and does not
          store IP addresses or device information itself. Our hosting provider processes
          network requests as part of serving the site.
        </p>

        <h2>Who else can see it</h2>
        <p>
          People in your own organization see your organization&rsquo;s information, according
          to their role. People outside it do not.
        </p>
        <p>
          <strong>One exception, and it is deliberate:</strong> facilities are shared. When you
          add a ballpark, other organizations can find it, so nobody has to re-enter the same
          venue. The shared record holds the facility&rsquo;s name, address, fields and
          amenities. <strong>Your own notes about a facility — parking, gates, whether
          you&rsquo;d go back — stay private to your organization.</strong>
        </p>
        <p>We do not sell information, and we do not share it for advertising.</p>

        <h2>Services we rely on</h2>
        <p>These companies process information as part of running {PRODUCT}:</p>
        <ul className="legal-list">
          {SUBPROCESSORS.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong> — {s.role}. {s.detail}
            </li>
          ))}
        </ul>
        <p>
          Fonts and other assets are served from the application itself rather than from
          third-party networks, so loading a page does not send your details anywhere else.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Information is kept until you delete it or ask us to remove your account. Nothing is
          deleted automatically. Past seasons are retained so your history stays intact.
        </p>

        <h2>Deleting your information</h2>
        <p>
          You can delete most records yourself inside the application. To have your account and
          your organization&rsquo;s information removed entirely, email{" "}
          <strong>{PRIVACY_EMAIL}</strong> from the address on your account. During early access
          this is handled manually. We will confirm when it is done.
        </p>
        <p>
          Shared facility records are not removed, because other organizations may rely on them.
          They contain no personal information.
        </p>

        <h2>Security</h2>
        <p>
          Access is controlled at the database level, so the rules apply whether a request comes
          from the application or anywhere else. Uploaded documents are stored privately and
          reachable only through a short-lived link generated for someone permitted to see them.
        </p>
        <p>
          No service can promise perfect security, and we make no such promise. Please tell us
          promptly if you believe an account has been misused.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes in a way that matters, we will update the version above and ask
          you to review it when you next sign in.
        </p>

        <h2>Contact</h2>
        <p>
          {LEGAL_ENTITY}<br />
          Privacy and data requests: <strong>{PRIVACY_EMAIL}</strong><br />
          General support: <strong>{SUPPORT_EMAIL}</strong>
        </p>
      </main>

      <footer className="mk-footer">
        <div className="mk-wrap mk-footer-inner">
          <span className="muted">{LEGAL_ENTITY}</span>
          <nav className="mk-footer-nav">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/">Home</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
