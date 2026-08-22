import "../../home.css";
import "./arrangement.css";
import { Arrangement } from "../../../components/Arrangement";

export const dynamic = "force-static";

export const metadata = {
  title: "Arrangement prototype",
  robots: { index: false, follow: false },
};

/**
 * ISOLATED CONCEPT. Sits beside /prototype/lineup so the two can be compared
 * directly. Not linked, not indexed, and it touches no marketing page.
 *
 * The question this exists to answer: with no interaction at all, does the
 * resting composition read as five substantial connected products rather than
 * as tabs with screenshots?
 */
export default function ArrangementPrototype() {
  return (
    <div className="proto">
      <header className="proto-head">
        <p className="proto-eyebrow">Prototype · concept B · not a live page</p>
        <h1>The Arrangement</h1>
        <p className="proto-note">
          Five real product objects on one ground. Select one to bring it forward and see its
          other states. Same arrangement in both treatments.
        </p>
      </header>

      <section className="ar-block">
        <p className="ar-label">Dark ground</p>
        <Arrangement tone="dark" />
      </section>

      <section className="ar-block ar-block-alt">
        <p className="ar-label">Light ground</p>
        <Arrangement tone="light" />
      </section>

      <footer className="proto-foot">
        <div className="proto-wrap">
          <p>
            Every object is a real capture of Season Tempo, cropped. Nothing drawn, redrawn or
            composited. At rest the objects are not meant to be readable &mdash; only recognisable.
          </p>
        </div>
      </footer>
    </div>
  );
}
