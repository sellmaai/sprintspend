import { loadConfig } from "../lib/config.js";
import { getLedger, getUnsyncedDelta, markSynced } from "../lib/ledger.js";
import { createLinearClient, updateIssueAiSpend } from "../lib/linear.js";

export async function sync(): Promise<void> {
  const config = loadConfig();
  if (!config?.linearAccessToken || !config?.linearCustomFieldId) {
    console.error("Not configured. Run: sprintspends configure");
    process.exit(1);
  }

  const ledger = await getLedger();
  const client = createLinearClient(config.linearAccessToken);
  let synced = 0;

  for (const [issueId, totals] of Object.entries(ledger.issueTotals)) {
    const delta = totals.totalCost - totals.lastSyncedCost;
    if (delta < 0.001) continue;

    try {
      await updateIssueAiSpend(
        client,
        issueId,
        config.linearCustomFieldId,
        delta
      );
      await markSynced(issueId, totals.totalCost);
      synced++;

      const identifier =
        ledger.entries.find((e) => e.linearIssueId === issueId)
          ?.linearIssueIdentifier ?? issueId;
      console.log(`  ${identifier}: +$${delta.toFixed(2)} synced`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Failed to sync ${issueId}: ${msg}`);
    }
  }

  if (synced === 0) {
    console.log("Everything is up to date.");
  } else {
    console.log(`\nSynced ${synced} issue(s) to Linear.`);
  }
}
