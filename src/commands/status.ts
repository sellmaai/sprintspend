import { getLedger } from "../lib/ledger.js";

export async function status(): Promise<void> {
  const ledger = await getLedger();

  if (ledger.entries.length === 0) {
    console.log("No tracked sessions yet.");
    return;
  }

  console.log("SprintSpends - Cost Summary\n");

  // Group by issue
  const byIssue: Record<string, { cost: number; sessions: number; synced: number }> = {};
  let unclassifiedCost = 0;
  let unclassifiedSessions = 0;

  for (const entry of ledger.entries) {
    if (entry.linearIssueIdentifier) {
      const key = entry.linearIssueIdentifier;
      if (!byIssue[key]) byIssue[key] = { cost: 0, sessions: 0, synced: 0 };
      byIssue[key].cost += entry.totalCost;
      byIssue[key].sessions++;
      if (entry.syncedToLinear) byIssue[key].synced++;
    } else {
      unclassifiedCost += entry.totalCost;
      unclassifiedSessions++;
    }
  }

  // Print table
  console.log(
    "Issue".padEnd(16) +
      "Cost".padStart(10) +
      "Sessions".padStart(10) +
      "Synced".padStart(10)
  );
  console.log("-".repeat(46));

  for (const [issue, data] of Object.entries(byIssue).sort(
    (a, b) => b[1].cost - a[1].cost
  )) {
    console.log(
      issue.padEnd(16) +
        `$${data.cost.toFixed(2)}`.padStart(10) +
        `${data.sessions}`.padStart(10) +
        `${data.synced}/${data.sessions}`.padStart(10)
    );
  }

  if (unclassifiedSessions > 0) {
    console.log(
      "(unclassified)".padEnd(16) +
        `$${unclassifiedCost.toFixed(2)}`.padStart(10) +
        `${unclassifiedSessions}`.padStart(10) +
        "-".padStart(10)
    );
  }

  const totalCost = ledger.entries.reduce((s, e) => s + e.totalCost, 0);
  console.log("-".repeat(46));
  console.log(
    "Total".padEnd(16) +
      `$${totalCost.toFixed(2)}`.padStart(10) +
      `${ledger.entries.length}`.padStart(10)
  );
}
