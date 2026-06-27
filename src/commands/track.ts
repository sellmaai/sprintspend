import { loadConfig } from "../lib/config.js";
import { parseTranscript } from "../lib/transcript.js";
import {
  addOrUpdateEntry,
  getEntryBySessionId,
  getUnsyncedDelta,
  markSynced,
} from "../lib/ledger.js";
import { classifyConversation } from "../lib/classifier.js";
import {
  createLinearClient,
  getMyActiveIssues,
  updateIssueAiSpend,
} from "../lib/linear.js";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../lib/config.js";
import type { HookInput, LedgerEntry } from "../types.js";

const CLASSIFY_AFTER_TURNS = 3;
const MIN_COST_DELTA_TO_SYNC = 0.001; // $0.001

function logError(message: string, error?: unknown): void {
  const logPath = join(getConfigDir(), "error.log");
  const timestamp = new Date().toISOString();
  const errStr = error instanceof Error ? error.message : String(error ?? "");
  appendFileSync(logPath, `[${timestamp}] ${message} ${errStr}\n`, "utf-8");
}

export async function track(): Promise<void> {
  try {
    // Read hook input from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    const { session_id, transcript_path, cwd } = input;
    if (!session_id || !transcript_path) return;

    // Load config — if not configured, exit silently
    const config = loadConfig();
    if (!config?.linearAccessToken || !config?.anthropicApiKey) return;

    // Parse transcript
    const usage = parseTranscript(transcript_path);
    if (usage.totalCost === 0) return;

    // Check existing entry for this session
    const existingEntry = await getEntryBySessionId(session_id);

    // Determine if we need to classify
    let issueId = existingEntry?.linearIssueId ?? null;
    let issueIdentifier = existingEntry?.linearIssueIdentifier ?? null;
    const needsClassification =
      !issueId &&
      usage.turnCount >= CLASSIFY_AFTER_TURNS;

    if (needsClassification) {
      try {
        const client = createLinearClient(config.linearAccessToken);
        const issues = await getMyActiveIssues(client);

        if (issues.length > 0) {
          const result = await classifyConversation(
            config.anthropicApiKey,
            usage.conversationExcerpt,
            issues
          );
          if (result.issueId && result.confidence !== "none") {
            issueId = result.issueId;
            issueIdentifier = result.issueIdentifier;
          }
        }
      } catch (err) {
        logError("Classification failed", err);
      }
    }

    // Build ledger entry
    const entry: LedgerEntry = {
      sessionId: session_id,
      timestamp: new Date().toISOString(),
      cwd,
      linearIssueId: issueId,
      linearIssueIdentifier: issueIdentifier,
      models: usage.models,
      totalCost: usage.totalCost,
      turnCount: usage.turnCount,
      lastTrackedTurnCount: usage.turnCount,
      syncedToLinear: false,
    };

    await addOrUpdateEntry(entry);

    // Sync to Linear if we have an issue and meaningful cost delta
    if (issueId && config.linearCustomFieldId) {
      const delta = await getUnsyncedDelta(issueId);
      if (delta >= MIN_COST_DELTA_TO_SYNC) {
        try {
          const client = createLinearClient(config.linearAccessToken);
          await updateIssueAiSpend(
            client,
            issueId,
            config.linearCustomFieldId,
            delta
          );
          const totalCost =
            (existingEntry?.totalCost ?? 0) + delta;
          await markSynced(issueId, totalCost);
        } catch (err) {
          logError("Linear sync failed", err);
        }
      }
    }
  } catch (err) {
    logError("Track command failed", err);
  }
}
