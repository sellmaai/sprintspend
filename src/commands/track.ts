import { loadConfig, getConfigDir } from "../lib/config.js";
import { parseTranscript } from "../lib/transcript.js";
import {
  addOrUpdateEntry,
  getEntryBySessionId,
  getUnsyncedDelta,
  markSynced,
} from "../lib/ledger.js";
import {
  createLinearClient,
  updateIssueAiSpend,
} from "../lib/linear.js";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { HookInput, LedgerEntry } from "../types.js";

const MIN_COST_DELTA_TO_SYNC = 0.001; // $0.001

function logError(message: string, error?: unknown): void {
  const logPath = join(getConfigDir(), "error.log");
  const timestamp = new Date().toISOString();
  const errStr = error instanceof Error ? error.message : String(error ?? "");
  appendFileSync(logPath, `[${timestamp}] ${message} ${errStr}\n`, "utf-8");
}

interface ClassificationFile {
  issueId: string;
  issueIdentifier: string;
  confidence: string;
}

function readClassification(sessionId: string): ClassificationFile | null {
  const filePath = join(getConfigDir(), "classifications", `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
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

    // Load config — only need Linear token now
    const config = loadConfig();
    if (!config?.linearAccessToken) return;

    // Parse transcript
    const usage = parseTranscript(transcript_path);
    if (usage.totalCost === 0) return;

    // Check existing entry for this session
    const existingEntry = await getEntryBySessionId(session_id);

    // Read classification (written by the classify command)
    let issueId = existingEntry?.linearIssueId ?? null;
    let issueIdentifier = existingEntry?.linearIssueIdentifier ?? null;

    if (!issueId) {
      const classification = readClassification(session_id);
      if (classification) {
        issueId = classification.issueId;
        issueIdentifier = classification.issueIdentifier;
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
          const totalCost = (existingEntry?.totalCost ?? 0) + delta;
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
