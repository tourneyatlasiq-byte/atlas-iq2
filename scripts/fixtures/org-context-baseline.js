/**
 * Phase 3C-0 baseline: what production did for each of the 7 accounts BEFORE any 3C
 * application change, captured 2026-11-17 on production main eb8054e with
 * scripts/sql/org-context-baseline.sql (an always-aborting, read-only probe).
 *
 * Rows are counts, never row contents; no emails, tokens or names of people.
 * `visible` = rows the account can read per table (every one of them was in its own
 * organization: the probe also counted rows of any other organization and found 0 in
 * every table, every scenario). `updatable` = rows a no-op UPDATE reached (aborted).
 * Re-run the probe after each 3C batch and compare: the numbers must not move.
 */
const BLOCKED_PINS = ["mismatch", "nonexistent", "malformed", "empty", "duplicate", "commajoined"];
const SAME_ORG_PINS = ["absent", "match", "uppercasekey"];

// The same 14 tables, in the same order, for the three Northgate accounts (owner x2, coach).
const northgateVisible = {
  games: 5, teams: 1, players: 15, seasons: 1, contacts: 2, profiles: 3, documents: 2,
  intake_runs: 2, tournaments: 10, budget_items: 14, organizations: 1, player_contacts: 14,
  player_payments: 13, game_lineup_slots: 59, plate_appearances: 102, budget_transactions: 15,
  team_season_players: 14, organization_features: 1, organization_facilities: 4,
  tournament_participants: 36,
};

const accounts = [
  {
    key: "armor-elite-owner", org: "Armor Elite", orgId: "4945aa3a-887f-4932-a886-c0527abed80d",
    uid: "2957bcc6-ef6e-436c-b2ff-4d29e8a37b52", role: "owner", authority: "owner",
    assignedTeams: 0, orgTeams: 1, orgMemberships: 1, peopleRoles: ["owner"],
    visible: { games: 13, teams: 1, players: 14, seasons: 1, profiles: 1, intake_runs: 5, tournaments: 13,
      budget_items: 1, organizations: 1, player_payments: 12, game_lineup_slots: 137, plate_appearances: 361,
      team_season_players: 12, organization_features: 1, tournament_participants: 11, organization_memberships: 1 },
    updatable: { games: 13, teams: 1, players: 14, profiles: 1, tournaments: 13, budget_items: 1,
      player_payments: 12, game_lineup_slots: 137, plate_appearances: 361, tournament_participants: 11 },
  },
  {
    key: "armor-elite-mower-owner", org: "Armor Elite (Mower)", orgId: "106fa06f-25c8-4f14-914f-19971c66265b",
    uid: "705b4da5-a8f9-4d0a-8c22-5c752b3d6bb6", role: "owner", authority: "owner",
    assignedTeams: 0, orgTeams: 1, orgMemberships: 1, peopleRoles: ["owner"],
    visible: { games: 11, teams: 1, invites: 5, players: 19, seasons: 1, contacts: 4, profiles: 1, documents: 7,
      intake_runs: 1, tournaments: 11, budget_items: 35, invite_sends: 3, player_links: 13, organizations: 1,
      player_contacts: 27, player_payments: 14, game_lineup_slots: 109, plate_appearances: 259,
      budget_transactions: 23, team_season_players: 18, tournament_resources: 2, organization_features: 1,
      organization_facilities: 2, tournament_participants: 21, organization_memberships: 1, player_college_interests: 1 },
    updatable: { games: 11, teams: 1, invites: 5, players: 19, contacts: 4, profiles: 1, documents: 7, tournaments: 11,
      budget_items: 35, player_links: 13, player_contacts: 27, player_payments: 14, game_lineup_slots: 109,
      plate_appearances: 259, budget_transactions: 23, tournament_resources: 2, organization_facilities: 2,
      tournament_participants: 21, player_college_interests: 1 },
  },
  {
    key: "braves-owner", org: "Braves", orgId: "309d1221-7a72-4134-a6cc-67ef38d5f93d",
    uid: "e086d77c-dd38-46fe-a6f5-839267f21905", role: "owner", authority: "owner",
    assignedTeams: 0, orgTeams: 1, orgMemberships: 1, peopleRoles: ["owner"],
    visible: { games: 4, teams: 1, players: 9, seasons: 1, contacts: 1, profiles: 1, tournaments: 1, organizations: 1,
      player_contacts: 9, player_payments: 9, team_season_players: 9, organization_features: 1,
      tournament_participants: 9, organization_memberships: 1 },
    updatable: { games: 4, teams: 1, players: 9, contacts: 1, profiles: 1, tournaments: 1, player_contacts: 9,
      player_payments: 9, tournament_participants: 9 },
  },
  {
    key: "northgate-coach", org: "Northgate Fastpitch", orgId: "a71a5000-0000-0000-0000-000000000001",
    uid: "99aeb112-78d1-4914-bc52-3a6f0428effe", role: "coach", authority: "member",
    assignedTeams: 1, orgTeams: 1, orgMemberships: 1, peopleRoles: ["coach", "owner", "owner"],
    visible: { ...northgateVisible, team_memberships: 1, organization_memberships: 1 },
    // A coach writes operational data but not structure: no teams, invites, features or intake_runs.
    updatable: { games: 5, players: 15, contacts: 2, profiles: 1, documents: 2, tournaments: 10, budget_items: 14,
      player_contacts: 14, player_payments: 13, game_lineup_slots: 59, plate_appearances: 102,
      budget_transactions: 15, organization_facilities: 4, tournament_participants: 36 },
  },
  ...["6452ca9a-aaed-4e28-9dc1-e2f3aa6c058b", "9e66ec43-a138-4945-be27-351dffcb1004"].map((uid, i) => ({
    key: `northgate-owner-${i + 1}`, org: "Northgate Fastpitch", orgId: "a71a5000-0000-0000-0000-000000000001",
    uid, role: "owner", authority: "owner",
    assignedTeams: 0, orgTeams: 1, orgMemberships: 3, peopleRoles: ["coach", "owner", "owner"],
    visible: { ...northgateVisible, invites: 2, invite_sends: 1, team_memberships: 1, organization_memberships: 3 },
    updatable: { games: 5, teams: 1, invites: 2, players: 15, contacts: 2, profiles: 1, documents: 2, tournaments: 10,
      budget_items: 14, player_contacts: 14, player_payments: 13, game_lineup_slots: 59, plate_appearances: 102,
      budget_transactions: 15, organization_facilities: 4, tournament_participants: 36 },
  })),
  {
    key: "test-org-owner", org: "Test Organization", orgId: "a23c8e8e-cd64-42e4-ab61-ba3cb6e57368",
    uid: "2778f0f1-a2bc-494e-87bb-c738f710b31a", role: "owner", authority: "owner",
    assignedTeams: 0, orgTeams: 1, orgMemberships: 1, peopleRoles: ["owner"],
    visible: { teams: 1, players: 2, seasons: 1, profiles: 1, tournaments: 1, organizations: 1, player_payments: 1,
      team_season_players: 2, organization_memberships: 1 },
    updatable: { teams: 1, players: 2, profiles: 1, tournaments: 1, player_payments: 1 },
  },
];

// Rows an account still sees when its pin names another organization or is invalid: only its
// OWN membership row (and, for the one account with a team assignment, that one assignment).
// These are policies on the person's own rows, independent of the organization pin.
const blockedVisible = (a) => ({
  organization_memberships: 1,
  ...(a.assignedTeams ? { team_memberships: a.assignedTeams } : {}),
});

// What the helpers returned for an account under each pin, as recorded for ALL 7 accounts:
// the same-organization pins resolved to the account's own organization, role and write/admin
// answers, with its teams and its season; every blocked pin resolved to nothing at all.
const helpersFor = (a, pin) => {
  if (SAME_ORG_PINS.includes(pin)) {
    return { org: "OWN", role: a.role, admin: a.authority === "owner", write: true,
      teams: a.role === "owner" ? a.orgTeams : a.assignedTeams, seasons: 1 };
  }
  if (BLOCKED_PINS.includes(pin)) return { org: null, role: null, admin: false, write: false, teams: 0, seasons: 0 };
  throw new Error("unknown pin scenario " + pin);
};

module.exports = {
  helpersFor,
  capturedAt: "2026-11-17", mainCommit: "eb8054e", migrationsApplied: 122,
  BLOCKED_PINS, SAME_ORG_PINS, accounts, blockedVisible,
  // No production account is a Manager. Probed synthetically (role flipped inside the aborting block):
  // identical to the Coach in every helper and in every table it can update.
  syntheticManager: { role: "manager", authority: "member", admin: false, write: true, teams: 1,
    updatableSameAsCoach: true },
  staleTeamAssignments: 0,
};
