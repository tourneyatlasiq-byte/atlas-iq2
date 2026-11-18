/**
 * Public homepage content that is data rather than prose.
 *
 * The season strip is an EXAMPLE season. Every name, place and amount is
 * fictional and matches the demo organization the homepage screenshots were
 * captured from (Bramblewood Fastpitch, 14U Gold, 2026-27), so the strip and
 * the product images describe the same team. The page labels it as an example.
 *
 * Status meanings follow the product: "Played" weekends are behind the team,
 * "Next up" is the one current weekend (gold), everything later is "Ahead".
 */
export const EXAMPLE_SEASON = {
  title: "An example team’s 2026-27 season",
  summary: {
    committedWeekends: 7,
    committedCost: "$3,855",
    paidSoFar: "$2,220",
    considering: "Two more still under consideration.",
  },
  weekends: [
    { date: "Aug 8", days: "Sat and Sun", name: "Dog Days Opener", place: "Cartersville, GA", status: "Played", cost: "$495", state: "played" },
    { date: "Sep 12", days: "Sat and Sun", name: "Harvest Classic", place: "Rome, GA", status: "Played", cost: "$550", state: "played" },
    { date: "Sep 26", days: "Sat and Sun", name: "Fall Ball Showcase", place: "Gainesville, GA", status: "Played", cost: "$525", state: "played" },
    { date: "Oct 17", days: "Sat and Sun", name: "Red Clay Classic", place: "Columbus, GA", status: "Next up, paid", cost: "$650", state: "next" },
    { date: "Nov 7", days: "Sat and Sun", name: "Blue Ridge Fall Finale", place: "Blue Ridge, GA", status: "Registered", cost: "$585", state: "ahead" },
    { date: "Feb 20", days: "Sat and Sun", name: "Winter Warm-Up", place: "Perry, GA", status: "Committed", cost: "$450", state: "ahead" },
    { date: "Mar 13", days: "Sat and Sun", name: "Spring Opener Slam", place: "Chattanooga, TN", status: "Committed", cost: "$600", state: "ahead" },
    { date: "Apr 23", days: "Fri to Sun", name: "Magnolia Showcase", place: "Huntsville, AL", status: "Considering", cost: "$725", state: "considering" },
    { date: "Jun 4", days: "Fri to Sun", name: "Gulf Coast Classic", place: "Gulf Shores, AL", status: "Considering", cost: "$895", state: "considering" },
  ],
};

/**
 * The opening's example weekend. Same team and tournament as the season data
 * and the tournament drawer screenshot (Red Clay Classic, Oct 17 to 18).
 * Fields are exactly what the printable Tournament Schedule prints with
 * "Include game schedule": tournament, dates, facility name and address, and
 * each game's date, start time, opponent and game type. Organizer, contacts,
 * costs and results are deliberately absent, as they are from the report.
 */
export const EXAMPLE_WEEKEND = {
  team: "Bramblewood 14U Gold",
  document: "Tournament Schedule",
  tournament: "Red Clay Classic",
  dates: "Saturday, Oct 17 to Sunday, Oct 18",
  facility: {
    name: "Red Clay Sports Park",
    street: "3100 Red Clay Way",
    cityLine: "Columbus, GA 31904",
  },
  days: [
    {
      label: "Saturday, Oct 17",
      games: [
        { time: "8:00", meridiem: "AM", opponent: "Cumberland Crush 14U", type: "Pool" },
        { time: "11:15", meridiem: "AM", opponent: "Bayou Blaze 14U", type: "Pool" },
        { time: "2:30", meridiem: "PM", opponent: "Ridgeline Rebels 14U", type: "Pool" },
      ],
    },
  ],
};

/**
 * Product screenshots, captured from the real application running against a
 * fictional demo organization. `w`/`h` are CSS pixels at 1x; every file also
 * has an @2x version. Width and height are always rendered so images never
 * shift the layout while loading.
 */
const shot = (name, w, h, alt) => ({ src: `/marketing/home/${name}.webp`, src2x: `/marketing/home/${name}@2x.webp`, w, h, alt });

export const SHOTS = {
  planTournaments: shot("plan-tournaments", 900, 732, "Tournaments: committed weekends with dates, organizer, facility, registration and payment status and entry fee, under a summary of committed cost and season record"),
  mPlanTournaments: shot("m-plan-tournaments", 390, 572, "Tournaments on a phone: committed cost, season record and the first committed weekends with their status and fees"),
  runHome: shot("run-home", 900, 340, "Home: the next tournament with a countdown, the weekends coming up, and a list of what still needs action"),
  runDrawer: shot("run-drawer", 480, 600, "Tournament drawer: dates, facility, committed and paid in full, games, roster and costs, and the tournament contact"),
  mRunHome: shot("m-run-home", 390, 472, "Home on a phone: the next tournament with a countdown and what still needs action"),
  moneySummary: shot("money-summary", 900, 264, "Finance: season budget split into paid, to pay and available, beside player dues collected and still to collect"),
  moneyBudget: shot("money-budget", 900, 424, "Season budget by category with budget, paid, to pay and available for each"),
  mMoneySummary: shot("m-money-summary", 390, 538, "Finance on a phone: season budget paid, to pay and available, and player dues collected"),
  manageSummary: shot("manage-summary", 480, 226, "Red Clay Classic in Season Tempo: Oct 17 to 18, Peachline Fastpitch Events, Red Clay Sports Park, Committed and Paid in Full, 3 games, 12 on the roster, $650 in costs"),
  manageTournament: shot("manage-tournament", 480, 336, "Red Clay Classic, Oct 17 to 18: committed and paid in full, with 3 games, 12 on the roster and $650 in costs, and the Are we going and Registration and payment fields"),
  informedSchedule: shot("informed-schedule", 916, 648, "Printable tournament schedule with facilities, addresses, game times and opponents"),
  informedBudget: shot("informed-budget", 916, 608, "Printable planned season budget showing the total and where the money goes by category"),
  mInformedSchedule: shot("m-informed-schedule", 358, 454, "Printable tournament schedule"),
};
