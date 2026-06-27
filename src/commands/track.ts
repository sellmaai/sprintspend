import { loadConfig, getConfigDir } from "../lib/config.js";
import { parseTranscript } from "../lib/transcript.js";
import {
  addOrUpdateEntry,
  getEntryBySessionId,
  withLedger,
} from "../lib/ledger.js";
import {
  createLinearClient,
  getMyProjects,
  updateProjectAiSpend,
} from "../lib/linear.js";
import { log, initLogLevel } from "../lib/logger.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { HookInput, LedgerEntry } from "../types.js";

const MIN_COST_DELTA_TO_SYNC = 0.001;
const CLASSIFY_AFTER_TURNS = 2;

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
  linearAccessToken: string
): Promise<ClassificationFile | null> {
  try {
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

    const prompt = `You are classifying a developer's Claude Code conversation to determine which Linear project they are working on.

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

    log.debug("Calling claude -p for classification");
    const result = execSync(
      `claude -p --model haiku --output-format json`,
      {
        input: prompt,
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, SPRINTSPENDS_CLASSIFYING: "1" },
      }
    );

    log.debug(`claude -p response: ${result.slice(0, 300)}`);

    let parsed: { project: string | null; confidence: string };
    try {
      const jsonResponse = JSON.parse(result.trim());
      const text = jsonResponse.result ?? jsonResponse.content ?? result;
      const match = typeof text === "string" ? text.match(/\{[^}]+\}/) : null;
      parsed = match ? JSON.parse(match[0]) : JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
    } catch {
      const match = result.match(/\{[^}]+\}/);
      if (!match) {
        log.error("Could not parse classification response from claude -p");
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

export async function track(): Promise<void> {
  try {
    if (process.env.SPRINTSPENDS_CLASSIFYING === "1") return;

    initLogLevel();

    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    const { session_id, transcript_path, cwd } = input;
    if (!session_id || !transcript_path) return;

    const config = loadConfig();
    if (!config?.linearAccessToken) {
      log.debug("No linearAccessToken in config, skipping");
      return;
    }

    const usage = parseTranscript(transcript_path);
    log.debug(`Session ${session_id.slice(0, 8)}: turns=${usage.turnCount} cost=$${usage.totalCost.toFixed(4)} excerpt=${usage.conversationExcerpt.length}chars`);
    if (usage.totalCost === 0) return;

    const existingEntry = await getEntryBySessionId(session_id);

    let projectId = existingEntry?.linearProjectId ?? null;
    let projectName = existingEntry?.linearProjectName ?? null;

    if (!projectId) {
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
          config.linearAccessToken
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
      linearProjectId: projectId,
      linearProjectName: projectName,
      models: usage.models,
      totalCost: usage.totalCost,
      turnCount: usage.turnCount,
      lastTrackedTurnCount: usage.turnCount,
      syncedToLinear: false,
    };

    await addOrUpdateEntry(entry);
    log.verbose(`Tracked session ${session_id.slice(0, 8)}: $${usage.totalCost.toFixed(2)} → ${projectName ?? "unclassified"}`);

    // Sync to Linear under ledger lock to prevent race between parallel sessions
    if (projectId) {
      await withLedger(async (ledger) => {
        const totals = ledger.projectTotals[projectId!];
        if (!totals) return;
        const delta = totals.totalCost - totals.lastSyncedCost;
        if (delta < MIN_COST_DELTA_TO_SYNC) return;

        try {
          log.verbose(`Syncing ${projectName}: $${totals.lastSyncedCost.toFixed(2)} → $${totals.totalCost.toFixed(2)} (+$${delta.toFixed(2)})`);
          const client = createLinearClient(config.linearAccessToken);
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
  } catch (err) {
    log.error("Track command failed", err);
  }
}
