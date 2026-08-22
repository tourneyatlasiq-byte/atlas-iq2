import "../../home.css";
import "./lineup.css";
import { Lineup } from "../../../components/Lineup";

export const dynamic = "force-static";

export const metadata = {
  title: "Lineup prototype",
  robots: { index: false, follow: false },
};

/**
 * ISOLATED PROTOTYPE. Not linked from anywhere, not indexed, and it touches no
 * marketing page. It exists to answer one question before any architecture is
 * committed: does presenting Season Tempo as isolated product objects create
 * the feeling we are after?
 *
 * Both stage treatments are shown with identical objects, type, dimensions and
 * interaction, so the comparison is of the treatment rather than of two
 * different designs.
 */
export default function LineupPrototype() {
  return (
    <div className="proto">
      <header className="proto-head">
        <p className="proto-eyebrow">Prototype · not a live page</p>
        <h1>The Lineup</h1>
        <p className="proto-note">
          Five modules, fourteen real product states. Same content and interaction in both
          treatments &mdash; only the stage changes.
        </p>
      </header>

      {/* ---- Hero, in the register it would actually use ------------------ */}
      <section className="proto-hero">
        <div className="proto-wrap">
          <h2 className="proto-h1">From the first entry fee to the last at-bat.</h2>
          <p className="proto-lede">
            Season Tempo is the software a travel softball season runs on.
          </p>
        </div>
      </section>

      <section className="proto-block">
        <div className="proto-wrap">
          <p className="proto-label">A · Dark stage</p>
          <Lineup tone="dark" />
        </div>
      </section>

      <section className="proto-block proto-block-alt">
        <div className="proto-wrap">
          <p className="proto-label">B · Light stage</p>
          <Lineup tone="light" />
        </div>
      </section>

      <footer className="proto-foot">
        <div className="proto-wrap">
          <p>
            Every state above is a real capture of Season Tempo, cropped and isolated. Nothing
            was drawn, redrawn or composited, and no transition implies behaviour the product
            does not have.
          </p>
        </div>
      </footer>
    </div>
  );
}
