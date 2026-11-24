// Decoration drawn on the large Volt discs of the public website.
//
// One entry per sport. Paths are stroke-only and drawn inside a 100 x 100 box
// that is the disc. To change the sport, change SITE_SPORT (or add an entry
// below); the logo, the disc, the layout and the screenshots do not change.
// Line strength, colour and angle are CSS variables in app/site.css (.sx-seams).
export const SITE_SPORT = "softball";

export const DISC_MOTIFS = {
  softball: {
    // two seam curves; "stitch" adds the small cross-stitch ticks along them
    paths: ["M31 6 C54 30 54 70 31 94", "M69 6 C46 30 46 70 69 94"],
    stitch: true,
  },
};
