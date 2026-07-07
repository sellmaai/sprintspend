import { loadConfig, getConfigDir } from "../lib/config.js";
import { parseAnyTranscript } from "../lib/transcript-detect.js";
import {
  addOrUpdateEntry,
  getEntryBySessionId,
  withLedger,
  migrateLedger,
} from "../lib/ledger.js";
import {
  createLinearClient,
  getMyProjects,
  updateProjectAiSpend,
} from "../lib/linear.js";
import { log, initLogLevel } from "../lib/logger.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import type { HookInput, LedgerEntry } from "../types.js";

function detectClassifierCli(preference?: "claude" | "codex" | "auto"): string | null {
  if (preference && preference !== "auto") {
    try {
      execFileSync("which", [preference], { stdio: "pipe" });
      return preference;
    } catch {
      log.debug(`Preferred classifier CLI "${preference}" not found`);
    }
  }
  // Auto-detect: prefer claude (cheaper classification), fall back to codex
  for (const cli of ["claude", "codex"]) {
    try {
      execFileSync("which", [cli], { stdio: "pipe" });
      return cli;
    } catch {
      // Not installed
    }
  }
  return null;
}

const MIN_COST_DELTA_TO_SYNC = 0.001;
const CLASSIFY_AFTER_TURNS = 2;

interface CodexSessionInfo {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
}

function parseCodexSessionMeta(filePath: string): CodexSessionInfo | null {
  try {
    const firstLine = readFileSync(filePath, "utf-8").split("\n")[0]?.trim();
    if (!firstLine) return null;
    const meta = JSON.parse(firstLine);
    if (meta.type === "session_meta" && meta.payload) {
      return {
        sessionId: meta.payload.id ?? "",
        transcriptPath: filePath,
        cwd: meta.payload.cwd ?? process.cwd(),
      };
    }
  } catch { /* fall through */ }

  // Fallback: extract ID from filename
  const match = filePath.match(/rollout-.*?-([\da-f-]+)\.jsonl$/);
  return {
    sessionId: match?.[1] ?? `codex-${Date.now()}`,
    transcriptPath: filePath,
    cwd: process.cwd(),
  };
}

function findLatestCodexSession(): CodexSessionInfo | null {
  const sessionsDir = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsDir)) return null;

  let latestPath = "";
  let latestMtime = 0;

  function walkDir(dir: string): void {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            walkDir(full);
          } else if (entry.endsWith(".jsonl") && stat.mtimeMs > latestMtime) {
            latestMtime = stat.mtimeMs;
            latestPath = full;
          }
        } catch { /* skip inaccessible */ }
      }
    } catch { /* skip inaccessible */ }
  }

  walkDir(sessionsDir);
  if (!latestPath) return null;
  return parseCodexSessionMeta(latestPath);
}

function classifyDir(): string {
  const dir = join(getConfigDir(), "classifications");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

interface ClassificationFile {
  projectId: string;
  projectName: string;
  confidence: string;
}

function readClassification(sessionId: string): ClassificationFile | null {
  const filePath = join(classifyDir(), `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

async function classifySession(
  sessionId: string,
  conversationExcerpt: string,
  linearAccessToken: string,
  classifierCliPref?: "claude" | "codex" | "auto"
): Promise<ClassificationFile | null> {
  try {
    const classifierCli = detectClassifierCli(classifierCliPref);
    if (!classifierCli) {
      log.verbose("No classifier CLI (claude or codex) found, skipping classification");
      return null;
    }

    const client = createLinearClient(linearAccessToken);
    const projects = await getMyProjects(client);
    log.debug(`Fetched ${projects.length} projects: ${projects.map(p => p.name).join(", ")}`);
    if (projects.length === 0) {
      log.verbose("No projects found in Linear, skipping classification");
      return null;
    }

    const projectList = projects
      .map((p) => {
        const desc = p.description ? ` - ${p.description.slice(0, 100)}` : "";
        return `${p.name}${desc}`;
      })
      .join("\n");

    const prompt = `You are classifying a developer's AI coding session to determine which Linear project they are working on.

## Active Linear Projects
${projectList}

## Conversation Excerpt
${conversationExcerpt}

## Instructions
Based on the conversation content, determine which Linear project the developer is most likely working on.
Respond with ONLY a JSON object (no markdown, no explanation):
{"project": "Project Name", "confidence": "high"}

Use "high" if the match is clear, "low" if it's a guess.
If no project matches: {"project": null, "confidence": "none"}`;

    // Build CLI command based on detected classifier
    const cmd = classifierCli === "claude"
      ? `claude -p --model haiku --output-format json`
      : `codex -p --model o4-mini`;

    log.debug(`Calling ${cmd} for classification`);
    const result = execSync(cmd, {
      input: prompt,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SPRINTSPENDS_CLASSIFYING: "1" },
    });

    log.debug(`Classifier response: ${result.slice(0, 300)}`);

    let parsed: { project: string | null; confidence: string };
    try {
      const jsonResponse = JSON.parse(result.trim());
      const text = jsonResponse.result ?? jsonResponse.content ?? result;
      const match = typeof text === "string" ? text.match(/\{[^}]+\}/) : null;
      parsed = match ? JSON.parse(match[0]) : JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
    } catch {
      const match = result.match(/\{[^}]+\}/);
      if (!match) {
        log.error("Could not parse classification response");
        return null;
      }
      parsed = JSON.parse(match[0]);
    }

    log.debug(`Classification result: project=${parsed.project} confidence=${parsed.confidence}`);

    if (!parsed.project || parsed.confidence === "none") {
      log.verbose(`Session ${sessionId.slice(0, 8)} unclassified (no matching project)`);
      return null;
    }

    const matchedProject = projects.find(
      (p) => p.name.toLowerCase() === parsed.project!.toLowerCase()
    );
    if (!matchedProject) {
      log.verbose(`Classification "${parsed.project}" did not match any project name`);
      return null;
    }

    const classification: ClassificationFile = {
      projectId: matchedProject.id,
      projectName: matchedProject.name,
      confidence: parsed.confidence,
    };

    const outPath = join(classifyDir(), `${sessionId}.json`);
    writeFileSync(outPath, JSON.stringify(classification), "utf-8");

    log.info(`Classified session ${sessionId.slice(0, 8)} → ${matchedProject.name} (${parsed.confidence})`);
    return classification;
  } catch (err) {
    log.error("Classification failed", err);
    return null;
  }
}

/**
 * Core tracking logic: parse a transcript, classify, ledger, sync.
 * Reusable by both the hook-triggered track command and the configure backfill.
 */
export async function trackSession(
  session_id: string,
  transcript_path: string,
  cwd: string,
  config: { linearAccessToken: string; classifierCli?: "claude" | "codex" | "auto" },
  opts?: { skipClassification?: boolean }
): Promise<void> {
  const usage = parseAnyTranscript(transcript_path);
  log.debug(`Session ${session_id.slice(0, 8)} [${usage.provider}]: turns=${usage.turnCount} cost=$${usage.totalCost.toFixed(4)} excerpt=${usage.conversationExcerpt.length}chars`);
  if (usage.totalCost === 0) return;

  const existingEntry = await getEntryBySessionId(session_id);

  let projectId = existingEntry?.linearProjectId ?? null;
  let projectName = existingEntry?.linearProjectName ?? null;

  if (!projectId && !opts?.skipClassification) {
    const cached = readClassification(session_id);
    if (cached) {
      projectId = cached.projectId;
      projectName = cached.projectName;
      log.debug(`Using cached classification: ${cached.projectName}`);
    } else if (usage.turnCount >= CLASSIFY_AFTER_TURNS) {
      log.verbose(`Classifying session ${session_id.slice(0, 8)}...`);
      const result = await classifySession(
        session_id,
        usage.conversationExcerpt,
        config.linearAccessToken,
        config.classifierCli
      );
      if (result) {
        projectId = result.projectId;
        projectName = result.projectName;
      }
    } else {
      log.debug(`Skipping classification: turn ${usage.turnCount} < ${CLASSIFY_AFTER_TURNS}`);
    }
  }

  const entry: LedgerEntry = {
    sessionId: session_id,
    timestamp: new Date().toISOString(),
    cwd,
    provider: usage.provider,
    linearProjectId: projectId,
    linearProjectName: projectName,
    models: usage.models,
    totalCost: usage.totalCost,
    turnCount: usage.turnCount,
    lastTrackedTurnCount: usage.turnCount,
    syncedToLinear: false,
  };

  const reclassifiedFrom = await addOrUpdateEntry(entry);
  log.verbose(`Tracked session ${session_id.slice(0, 8)}: $${usage.totalCost.toFixed(2)} → ${projectName ?? "unclassified"}`);

  // Sync to Linear under ledger lock to prevent race between parallel sessions
  if (projectId) {
    await withLedger(async (ledger) => {
      const client = createLinearClient(config.linearAccessToken);

      // If session was reclassified, re-sync the old project to decrement its cost
      if (reclassifiedFrom) {
        const oldTotals = ledger.projectTotals[reclassifiedFrom];
        if (oldTotals) {
          try {
            log.verbose(`Re-syncing old project ${reclassifiedFrom} after reclassification: $${oldTotals.totalCost.toFixed(2)}`);
            await updateProjectAiSpend(client, reclassifiedFrom, oldTotals.totalCost);
            oldTotals.lastSyncedCost = oldTotals.totalCost;
            oldTotals.lastSyncedAt = new Date().toISOString();
          } catch (err) {
            log.error("Failed to re-sync old project after reclassification", err);
          }
        }
      }

      const totals = ledger.projectTotals[projectId!];
      if (!totals || totals.totalCost <= 0) return;
      const delta = totals.totalCost - totals.lastSyncedCost;
      if (Math.abs(delta) < MIN_COST_DELTA_TO_SYNC) return;

      try {
        log.verbose(`Syncing ${projectName}: $${totals.lastSyncedCost.toFixed(2)} → $${totals.totalCost.toFixed(2)} (+$${delta.toFixed(2)})`);
        await updateProjectAiSpend(client, projectId!, totals.totalCost);
        totals.lastSyncedCost = totals.totalCost;
        totals.lastSyncedAt = new Date().toISOString();
        for (const e of ledger.entries) {
          if (e.linearProjectId === projectId) e.syncedToLinear = true;
        }
        log.info(`Synced $${totals.totalCost.toFixed(2)} to ${projectName}`);
      } catch (err) {
        log.error("Linear sync failed", err);
      }
    });
  }
}

export async function track(opts?: { codex?: boolean }): Promise<void> {
  try {
    if (process.env.SPRINTSPENDS_CLASSIFYING === "1") return;

    initLogLevel();

    let session_id: string;
    let transcript_path: string;
    let cwd: string;

    if (opts?.codex) {
      // Codex hook mode: find the latest session file
      const codexSession = findLatestCodexSession();
      if (!codexSession) {
        log.debug("No Codex session found, skipping");
        return;
      }
      session_id = codexSession.sessionId;
      transcript_path = codexSession.transcriptPath;
      cwd = codexSession.cwd;
      log.debug(`Codex mode: found session ${session_id.slice(0, 8)} at ${transcript_path}`);
    } else {
      // Claude Code hook mode: read HookInput from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const input: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      session_id = input.session_id;
      transcript_path = input.transcript_path;
      cwd = input.cwd;
    }

    if (!session_id || !transcript_path) return;

    const config = loadConfig();
    if (!config?.linearAccessToken) {
      log.debug("No linearAccessToken in config, skipping");
      return;
    }

    await migrateLedger();
    await trackSession(session_id, transcript_path, cwd, config);
  } catch (err) {
    log.error("Track command failed", err);
  }
}
