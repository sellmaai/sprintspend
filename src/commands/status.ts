import { getLedger } from "../lib/ledger.js";

export async function status(): Promise<void> {
  const ledger = await getLedger();

  if (ledger.entries.length === 0) {
    console.log("No tracked sessions yet.");
    return;
  }

  console.log("SprintSpends - Cost Summary\n");

  // Group by project
  const byProject: Record<string, { cost: number; sessions: number; synced: number }> = {};
  let unclassifiedCost = 0;
  let unclassifiedSessions = 0;

  for (const entry of ledger.entries) {
    if (entry.linearProjectName) {
      const key = entry.linearProjectName;
      if (!byProject[key]) byProject[key] = { cost: 0, sessions: 0, synced: 0 };
      byProject[key].cost += entry.totalCost;
      byProject[key].sessions++;
      if (entry.syncedToLinear) byProject[key].synced++;
    } else {
      unclassifiedCost += entry.totalCost;
      unclassifiedSessions++;
    }
  }

  console.log(
    "Project".padEnd(30) +
      "Cost".padStart(10) +
      "Sessions".padStart(10) +
      "Synced".padStart(10)
  );
  console.log("-".repeat(60));

  for (const [project, data] of Object.entries(byProject).sort(
    (a, b) => b[1].cost - a[1].cost
  )) {
    console.log(
      project.padEnd(30) +
        `$${data.cost.toFixed(2)}`.padStart(10) +
        `${data.sessions}`.padStart(10) +
        `${data.synced}/${data.sessions}`.padStart(10)
    );
  }

  if (unclassifiedSessions > 0) {
    console.log(
      "(unclassified)".padEnd(30) +
        `$${unclassifiedCost.toFixed(2)}`.padStart(10) +
        `${unclassifiedSessions}`.padStart(10) +
        "-".padStart(10)
    );
  }

  const totalCost = ledger.entries.reduce((s, e) => s + e.totalCost, 0);
  console.log("-".repeat(60));
  console.log(
    "Total".padEnd(30) +
      `$${totalCost.toFixed(2)}`.padStart(10) +
      `${ledger.entries.length}`.padStart(10)
  );
}
