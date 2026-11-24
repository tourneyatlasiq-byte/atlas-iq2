import { Shot } from "./MarketingChrome";

/**
 * "One tournament. Two views." The coach sees the tournament drawer; families
 * see the weekend plan the printable Tournament Schedule produces (team,
 * tournament, dates, facility, game times and opponents, no costs or notes).
 * Fictional example data only.
 */
const PLAN = {
  team: "Bramblewood 14U Gold",
  name: "Red Clay Classic",
  dates: "Saturday Oct 17 to Sunday Oct 18",
  place: "Red Clay Sports Park",
  address: "3100 Red Clay Way, Columbus, GA 31904",
  day: "Saturday, Oct 17",
  games: [
    { time: "8:00 AM", opp: "Cumberland Crush 14U", type: "Pool" },
    { time: "11:15 AM", opp: "Bayou Blaze 14U", type: "Pool" },
    { time: "2:30 PM", opp: "Ridgeline Rebels 14U", type: "Pool" },
  ],
};

export default function TwoViews() {
  return (
    <section className="sx-section sx-views" aria-labelledby="views-h">
      <div className="sx-wrap">
        <h2 className="sx-h2" id="views-h">One tournament. Two views.</h2>
        <p className="sx-p">
          You keep the registration, payment and roster. Families get the weekend plan:
          where to be and when.
        </p>
        <div className="sx-views-grid">
          <figure className="sx-view">
            <p className="sx-view-label">For the coach</p>
            <div className="sx-frame sx-view-card">
              <Shot name="coach-drawer" w={900} h={768} mw={780} mh={673}
                alt="The tournament in Season Tempo: Red Clay Classic, committed and paid in full, with games, roster and costs" />
            </div>
            <figcaption>Registration, payment, games, roster and cost, all on the tournament.</figcaption>
          </figure>

          <figure className="sx-view">
            <p className="sx-view-label">For families</p>
            <div className="sx-frame sx-plan">
              <p className="sx-plan-team">{PLAN.team}</p>
              <h3 className="sx-plan-name">{PLAN.name}</h3>
              <p className="sx-plan-dates">{PLAN.dates}</p>
              <p className="sx-plan-where"><b>{PLAN.place}</b><br />{PLAN.address}</p>
              <p className="sx-plan-day">{PLAN.day}</p>
              <ol className="sx-plan-games">
                {PLAN.games.map((g) => (
                  <li key={g.time}>
                    <span className="sx-plan-time">{g.time}</span>
                    <span className="sx-plan-opp">vs {g.opp}</span>
                    <span className="sx-plan-type">{g.type}</span>
                  </li>
                ))}
              </ol>
            </div>
            <figcaption>The printable Tournament Schedule. It leaves out costs and notes.</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
