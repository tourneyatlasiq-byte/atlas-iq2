import { getContext, canWrite } from "../../../lib/context";

export const dynamic = "force-dynamic";

function Row({ label, value }) {
  return (
    <tr>
      <td style={{ width: 200, color: "var(--slate)", fontWeight: 600 }}>{label}</td>
      <td>{value ?? <span className="muted">—</span>}</td>
    </tr>
  );
}

export default async function SettingsPage() {
  const { user, profile, organization, teams, team, seasons, season } = await getContext();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="page-sub">Account and organization context resolved for this session.</div>
        </div>
      </div>

      <div className="card card-flush">
        <div style={{ padding: "16px 16px 0" }}>
          <h2>Account</h2>
        </div>
        <table className="table">
          <tbody>
            <Row label="Signed in as" value={user.email} />
            <Row label="Name" value={profile?.full_name} />
            <Row label="Role" value={profile?.role} />
            <Row label="Can edit records" value={canWrite(profile) ? "Yes" : "No"} />
          </tbody>
        </table>
      </div>

      <div className="card card-flush">
        <div style={{ padding: "16px 16px 0" }}>
          <h2>Organization</h2>
        </div>
        <table className="table">
          <tbody>
            <Row label="Organization" value={organization?.name} />
            <Row label="Teams" value={teams.length > 0 ? teams.map((t) => t.name).join(", ") : null} />
            <Row label="Active team" value={team?.name} />
            <Row label="Current season" value={season ? `${season.name}${season.is_current ? " (current)" : ""}` : null} />
            <Row
              label="Season range"
              value={season?.start_date ? `${season.start_date} → ${season.end_date ?? "—"}` : null}
            />
            <Row label="All seasons" value={seasons.length > 0 ? seasons.map((s) => s.name).join(", ") : null} />
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Coming next</h2>
        <p className="page-sub" style={{ marginTop: 8 }}>
          Switching teams and seasons, editing organization details, and managing who has access
          are all planned. Right now Atlas IQ resolves the current team and season automatically.
        </p>
      </div>
    </>
  );
}
