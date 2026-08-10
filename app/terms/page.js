import Link from "next/link";
import { LogoLockup } from "../../components/SeasonTempoLogo";
import {
  LEGAL_ENTITY, PRODUCT, TERMS_VERSION, EFFECTIVE_DATE,
  PRIVACY_EMAIL, SUPPORT_EMAIL,
} from "../../lib/legal";
import "../home.css";

export const metadata = {
  title: "Terms of Service — Season Tempo",
  description: "The terms for using Season Tempo.",
};

/**
 * Written to describe the service that exists. No claims about uptime,
 * support response times, backups or certifications, because none of those
 * commitments have been made.
 */
export default function TermsPage() {
  return (
    <div className="legal-page">
      <header className="mk-header">
        <div className="mk-wrap mk-header-inner">
          <Link href="/" className="mk-logo" aria-label="Season Tempo home">
            <LogoLockup size={30} tone="navy" wordSize={22} />
          </Link>
          <nav className="mk-nav">
            <Link href="/privacy">Privacy</Link>
            <Link href="/">Home</Link>
          </nav>
        </div>
      </header>

      <main className="legal-wrap">
        <h1>Terms of Service</h1>
        <p className="legal-meta">
          Version {TERMS_VERSION} · Effective {EFFECTIVE_DATE}
        </p>

        <p className="legal-lede">
          {PRODUCT} is operated by {LEGAL_ENTITY}. By creating an account you agree to these
          terms. If you don&rsquo;t, please don&rsquo;t use the service.
        </p>

        <h2>Early access</h2>
        <p>
          {PRODUCT} is in early access. It is free during this period, features change, and
          things may occasionally break. We don&rsquo;t promise particular uptime, support
          response times, or that any feature will continue to exist. Please keep your own copy
          of anything you can&rsquo;t afford to lose.
        </p>

        <h2>Who may use it</h2>
        <p>
          You must be <strong>18 or older</strong> and authorized to act for the organization
          whose information you enter. Accounts are for coaches, team managers and other adults
          running a team.
        </p>
        <p>
          <strong>{PRODUCT} is not for children to use.</strong> Do not create an account for a
          player, and do not share your sign-in link with one.
        </p>

        <h2>Your account</h2>
        <p>
          Sign-in is by emailed link, so anyone who can read your email can reach your account.
          Keep that address secure and tell us if something looks wrong. You are responsible for
          what happens under your account and for the people you invite.
        </p>

        <h2>Information you enter</h2>
        <p>
          You keep ownership of what you enter. You give us permission to store and process it
          so the service can work.
        </p>
        <p>By entering information you confirm that:</p>
        <ul className="legal-list">
          <li>You have the right to provide it, including information about children.</li>
          <li>You have any consent needed from parents or guardians.</li>
          <li>It is accurate as far as you know.</li>
        </ul>

        <h2>What not to upload</h2>
        <p>
          {PRODUCT} is not designed to store highly sensitive personal information.{" "}
          <strong>Do not upload</strong> Social Security or national identification numbers,
          birth certificates, passports or other government identification, medical or health
          records, or payment card and bank account details.
        </p>
        <p>
          If we later build a feature specifically designed for a category of sensitive
          information, we will say so clearly. Until then, please assume it does not belong here.
        </p>

        <h2>Acceptable use</h2>
        <p>Don&rsquo;t use {PRODUCT} to:</p>
        <ul className="legal-list">
          <li>Break the law, or infringe anyone&rsquo;s rights.</li>
          <li>Reach information belonging to another organization, or try to.</li>
          <li>Interfere with the service or test its security without asking us first.</li>
          <li>Upload malicious files.</li>
          <li>Enter information about people you have no right to record.</li>
        </ul>

        <h2>Shared facilities</h2>
        <p>
          Facilities you add become part of a directory shared with other organizations, so
          nobody has to enter the same ballpark twice. Add only publicly true details — the
          name, address and amenities of a real venue.
        </p>
        <p>
          Your own notes about a facility stay private to your organization and are never shared.
        </p>

        <h2>Ending your use</h2>
        <p>
          You can stop at any time and ask us to remove your account by emailing{" "}
          <strong>{PRIVACY_EMAIL}</strong>. We may suspend or close an account that breaks these
          terms, or if we stop offering the service. If we close the service, we will give you
          reasonable notice and a chance to export your information.
        </p>

        <h2>No warranty</h2>
        <p>
          {PRODUCT} is provided &ldquo;as is&rdquo;. To the extent the law allows, {LEGAL_ENTITY}{" "}
          makes no warranties about it — including that it will be uninterrupted, error-free, or
          fit for a particular purpose.
        </p>
        <p>
          It is a record-keeping tool. It does not provide legal, financial, tax or medical
          advice, and shouldn&rsquo;t be relied on as the only record of anything important.
        </p>

        <h2>Limits</h2>
        <p>
          To the extent the law allows, {LEGAL_ENTITY} is not liable for indirect or
          consequential losses, or for lost data or profits. Because {PRODUCT} is free during
          early access, our total liability is limited to the amount you have paid us, which is
          currently nothing.
        </p>
        <p>Nothing here limits liability that cannot be limited by law.</p>

        <h2>Changes</h2>
        <p>
          We may update these terms. If a change matters, we will update the version above and
          ask you to review it when you next sign in. Continuing to use {PRODUCT} after that
          means you accept the new terms.
        </p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of the State of Georgia, United States, without
          regard to its conflict of laws rules.
        </p>

        <h2>Contact</h2>
        <p>
          {LEGAL_ENTITY}<br />
          General support: <strong>{SUPPORT_EMAIL}</strong><br />
          Privacy and data requests: <strong>{PRIVACY_EMAIL}</strong>
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
