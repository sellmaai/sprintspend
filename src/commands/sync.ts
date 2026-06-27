import { loadConfig } from "../lib/config.js";
import { getLedger, markSynced } from "../lib/ledger.js";
import { createLinearClient, updateProjectAiSpend } from "../lib/linear.js";

export async function sync(): Promise<void> {
  const config = loadConfig();
  if (!config?.linearAccessToken) {
    console.error("Not configured. Run: sprintspends configure");
    process.exit(1);
  }

  const ledger = await getLedger();
  const client = createLinearClient(config.linearAccessToken);
  let synced = 0;

  for (const [projectId, totals] of Object.entries(ledger.projectTotals)) {
    const delta = totals.totalCost - totals.lastSyncedCost;
    if (delta < 0.001) continue;

    try {
      await updateProjectAiSpend(client, projectId, totals.totalCost);
      await markSynced(projectId, totals.totalCost);
      synced++;

      const name =
        ledger.entries.find((e) => e.linearProjectId === projectId)
          ?.linearProjectName ?? projectId;
      console.log(`  ${name}: +$${delta.toFixed(2)} synced`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Failed to sync ${projectId}: ${msg}`);
    }
  }

  if (synced === 0) {
    console.log("Everything is up to date.");
  } else {
    console.log(`\nSynced ${synced} project(s) to Linear.`);
  }
}
