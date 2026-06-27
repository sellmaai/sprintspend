import { loadConfig } from "../lib/config.js";
import { parseTranscript } from "../lib/transcript.js";
import { createLinearClient, getMyActiveIssues } from "../lib/linear.js";
import { getEntryBySessionId } from "../lib/ledger.js";
import { getConfigDir } from "../lib/config.js";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { HookInput } from "../types.js";

const CLASSIFY_AFTER_TURNS = 3;

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
    // Read hook input from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input: HookInput = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    const { session_id, transcript_path } = input;
    if (!session_id || !transcript_path) return;

    // Load config — need Linear token but NOT Anthropic key
    const config = loadConfig();
    if (!config?.linearAccessToken) return;

    // Check if already classified
    const existing = await getEntryBySessionId(session_id);
    if (existing?.linearIssueId) return; // already classified

    // Parse transcript to check turn count and get excerpt
    const usage = parseTranscript(transcript_path);
    if (usage.turnCount < CLASSIFY_AFTER_TURNS) return;

    // Fetch active Linear issues
    const client = createLinearClient(config.linearAccessToken);
    const issues = await getMyActiveIssues(client);
    if (issues.length === 0) return;

    const issueList = issues
      .map((i) => {
        const desc = i.description ? ` - ${i.description.slice(0, 100)}` : "";
        return `${i.identifier}: ${i.title}${desc}`;
      })
      .join("\n");

    const prompt = `You are classifying a developer's Claude Code conversation to determine which Linear issue they are working on.

## Active Linear Issues
${issueList}

## Conversation Excerpt
${usage.conversationExcerpt}

## Instructions
Based on the conversation content, determine which Linear issue the developer is most likely working on.
Respond with ONLY a JSON object (no markdown, no explanation):
{"identifier": "ENG-123", "confidence": "high"}

Use "high" if the match is clear, "low" if it's a guess.
If no issue matches: {"identifier": null, "confidence": "none"}`;

    // Use the claude CLI itself — no separate API key needed
    const result = execSync(
      `claude -p --model haiku --output-format json`,
      {
        input: prompt,
        encoding: "utf-8",
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Parse Claude's response
    let parsed: { identifier: string | null; confidence: string };
    try {
      // claude --output-format json wraps response, extract the text
      const jsonResponse = JSON.parse(result.trim());
      const text = jsonResponse.result ?? jsonResponse.content ?? result;
      // The actual classification JSON might be inside the text
      const match = typeof text === "string" ? text.match(/\{[^}]+\}/) : null;
      parsed = match ? JSON.parse(match[0]) : JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
    } catch {
      // Try parsing raw output directly
      const match = result.match(/\{[^}]+\}/);
      if (!match) return;
      parsed = JSON.parse(match[0]);
    }

    if (!parsed.identifier || parsed.confidence === "none") return;

    // Find matching issue to get the ID
    const matchedIssue = issues.find((i) => i.identifier === parsed.identifier);
    if (!matchedIssue) return;

    // Write classification result for the track command to pick up
    const outPath = join(classifyDir(), `${session_id}.json`);
    writeFileSync(
      outPath,
      JSON.stringify({
        issueId: matchedIssue.id,
        issueIdentifier: matchedIssue.identifier,
        confidence: parsed.confidence,
        classifiedAt: new Date().toISOString(),
      }),
      "utf-8"
    );
  } catch (err) {
    logError("Classify command failed", err);
  }
}
