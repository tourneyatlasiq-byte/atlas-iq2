/**
 * One tournament weekend, set as the finished document families receive.
 *
 * Real text, not a picture, so it stays sharp and readable at every width and
 * is read by screen readers. Shows only what the printable Tournament
 * Schedule prints with "Include game schedule" (see EXAMPLE_WEEKEND).
 */
export function WeekendPlan({ weekend }) {
  const w = weekend;
  return (
    <div className="st-plan">
      <div className="st-plan-top">
        <span>{w.team}</span>
        <span>{w.document}</span>
      </div>

      <div className="st-plan-title">
        <h3 className="st-plan-name">{w.tournament}</h3>
        <p className="st-plan-dates">{w.dates}</p>
      </div>

      <div className="st-plan-body">
        <div className="st-plan-where">
          <h4 className="st-plan-k">Where</h4>
          <p className="st-plan-facility">{w.facility.name}</p>
          <address className="st-plan-address">
            {w.facility.street}
            <br />
            {w.facility.cityLine}
          </address>
        </div>

        {w.days.map((day) => (
          <div className="st-plan-day" key={day.label}>
            <h4 className="st-plan-k">{day.label}</h4>
            <ol className="st-plan-games">
              {day.games.map((g) => (
                <li key={g.time}>
                  <span className="st-plan-dot" aria-hidden="true" />
                  <span className="st-plan-time">
                    {g.time}
                    <span className="st-plan-ampm"> {g.meridiem}</span>
                  </span>
                  <span className="st-plan-opp">
                    <span className="st-plan-vs">vs </span>
                    {g.opponent}
                  </span>
                  <span className="st-plan-type">{g.type}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
