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
  getMyProjects,
  updateProjectAiSpend,
} from "../lib/linear.js";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { HookInput, LedgerEntry } from "../types.js";

const MIN_COST_DELTA_TO_SYNC = 0.001;
const CLASSIFY_AFTER_TURNS = 2;

function logError(message: string, error?: unknown): void {
  const logPath = join(getConfigDir(), "error.log");
  const timestamp = new Date().toISOString();
  const errStr = error instanceof Error ? error.message : String(error ?? "");
  appendFileSync(logPath, `[${timestamp}] ${message} ${errStr}\n`, "utf-8");
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
  linearAccessToken: string
): Promise<ClassificationFile | null> {
  try {
    const client = createLinearClient(linearAccessToken);
    const projects = await getMyProjects(client);
    if (projects.length === 0) return null;

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

    let parsed: { project: string | null; confidence: string };
    try {
      const jsonResponse = JSON.parse(result.trim());
      const text = jsonResponse.result ?? jsonResponse.content ?? result;
      const match = typeof text === "string" ? text.match(/\{[^}]+\}/) : null;
      parsed = match ? JSON.parse(match[0]) : JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
    } catch {
      const match = result.match(/\{[^}]+\}/);
      if (!match) return null;
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.project || parsed.confidence === "none") return null;

    const matchedProject = projects.find(
      (p) => p.name.toLowerCase() === parsed.project!.toLowerCase()
    );
    if (!matchedProject) return null;

    const classification: ClassificationFile = {
      projectId: matchedProject.id,
      projectName: matchedProject.name,
      confidence: parsed.confidence,
    };

    const outPath = join(classifyDir(), `${sessionId}.json`);
    writeFileSync(outPath, JSON.stringify(classification), "utf-8");

    return classification;
  } catch (err) {
    logError("Classification failed", err);
    return null;
  }
}

export async function track(): Promise<void> {
  try {
    if (process.env.SPRINTSPENDS_CLASSIFYING === "1") return;

    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    const { session_id, transcript_path, cwd } = input;
    if (!session_id || !transcript_path) return;

    const config = loadConfig();
    if (!config?.linearAccessToken) return;

    const usage = parseTranscript(transcript_path);
    if (usage.totalCost === 0) return;

    const existingEntry = await getEntryBySessionId(session_id);

    let projectId = existingEntry?.linearProjectId ?? null;
    let projectName = existingEntry?.linearProjectName ?? null;

    if (!projectId) {
      const cached = readClassification(session_id);
      if (cached) {
        projectId = cached.projectId;
        projectName = cached.projectName;
      } else if (usage.turnCount >= CLASSIFY_AFTER_TURNS) {
        const result = await classifySession(
          session_id,
          usage.conversationExcerpt,
          config.linearAccessToken
        );
        if (result) {
          projectId = result.projectId;
          projectName = result.projectName;
        }
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

    if (projectId) {
      const delta = await getUnsyncedDelta(projectId);
      if (delta >= MIN_COST_DELTA_TO_SYNC) {
        try {
          const client = createLinearClient(config.linearAccessToken);
          const totalProjectCost = (existingEntry?.totalCost ?? 0) + delta;
          await updateProjectAiSpend(client, projectId, totalProjectCost);
          await markSynced(projectId, totalProjectCost);
        } catch (err) {
          logError("Linear sync failed", err);
        }
      }
    }
  } catch (err) {
    logError("Track command failed", err);
  }
}
