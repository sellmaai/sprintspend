import { loadConfig, getConfigDir } from "../lib/config.js";
import { parseTranscript } from "../lib/transcript.js";
import { createLinearClient, getMyProjects } from "../lib/linear.js";
import { getEntryBySessionId } from "../lib/ledger.js";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { HookInput } from "../types.js";

const CLASSIFY_AFTER_TURNS = 2;

function classifyDir(): string {
  const dir = join(getConfigDir(), "classifications");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function logError(message: string, error?: unknown): void {
  const logPath = join(getConfigDir(), "error.log");
  const timestamp = new Date().toISOString();
  const errStr = error instanceof Error ? error.message : String(error ?? "");
  appendFileSync(logPath, `[${timestamp}] ${message} ${errStr}\n`, "utf-8");
}

export async function classify(): Promise<void> {
  try {
    if (process.env.SPRINTSPENDS_CLASSIFYING === "1") return;

    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    const { session_id, transcript_path } = input;
    if (!session_id || !transcript_path) return;

    const config = loadConfig();
    if (!config?.linearAccessToken) return;

    const existing = await getEntryBySessionId(session_id);
    if (existing?.linearProjectId) return; // already classified

    const usage = parseTranscript(transcript_path);
    if (usage.turnCount < CLASSIFY_AFTER_TURNS) return;

    // Fetch active Linear projects
    const client = createLinearClient(config.linearAccessToken);
    const projects = await getMyProjects(client);
    if (projects.length === 0) return;

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
${usage.conversationExcerpt}

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

    // Parse Claude's response
    let parsed: { project: string | null; confidence: string };
    try {
      const jsonResponse = JSON.parse(result.trim());
      const text = jsonResponse.result ?? jsonResponse.content ?? result;
      const match = typeof text === "string" ? text.match(/\{[^}]+\}/) : null;
      parsed = match ? JSON.parse(match[0]) : JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
    } catch {
      const match = result.match(/\{[^}]+\}/);
      if (!match) return;
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.project || parsed.confidence === "none") return;

    // Find matching project by name (case-insensitive)
    const matchedProject = projects.find(
      (p) => p.name.toLowerCase() === parsed.project!.toLowerCase()
    );
    if (!matchedProject) return;

    const outPath = join(classifyDir(), `${session_id}.json`);
    writeFileSync(
      outPath,
      JSON.stringify({
        projectId: matchedProject.id,
        projectName: matchedProject.name,
        confidence: parsed.confidence,
        classifiedAt: new Date().toISOString(),
      }),
      "utf-8"
    );
  } catch (err) {
    logError("Classify command failed", err);
  }
}
