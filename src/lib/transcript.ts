import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import type { SessionUsage, ModelUsage, TokenUsage, Provider } from "../types.js";
import { calculateCost } from "./pricing.js";

interface TranscriptLine {
  type?: string;
  sessionId?: string;
  cwd?: string;
  message?: {
    role?: string;
    model?: string;
    content?: Array<{ type?: string; text?: string }> | string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
  };
}

function extractUsage(line: TranscriptLine): {
  model: string;
  usage: TokenUsage;
} | null {
  const msg = line.message;
  if (!msg?.usage || !msg.model) return null;
  if (msg.usage.input_tokens === undefined && msg.usage.output_tokens === undefined) return null;

  const u = msg.usage;
  const cache = u.cache_creation;

  return {
    model: msg.model,
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      ephemeral_5m_input_tokens: cache?.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0,
      ephemeral_1h_input_tokens: cache?.ephemeral_1h_input_tokens ?? 0,
      reasoning_output_tokens: 0,
    },
  };
}

function extractTextContent(line: TranscriptLine): string {
  const content = line.message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join(" ");
}

function parseLines(filePath: string): TranscriptLine[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf-8");
  const lines: TranscriptLine[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines
    }
  }
  return lines;
}

function findSubagentTranscripts(transcriptPath: string): string[] {
  const dir = dirname(transcriptPath);
  const sessionId = basename(transcriptPath, ".jsonl");
  const subagentDir = join(dir, sessionId, "subagents");
  if (!existsSync(subagentDir)) return [];
  try {
    return readdirSync(subagentDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(subagentDir, f));
  } catch {
    return [];
  }
}

export function parseTranscript(transcriptPath: string): SessionUsage {
  const allFiles = [transcriptPath, ...findSubagentTranscripts(transcriptPath)];
  const models: Record<string, ModelUsage> = {};
  let sessionId = "";
  let cwd = "";
  let turnCount = 0;
  const excerptParts: string[] = [];
  let excerptLength = 0;
  const EXCERPT_MAX = 2000;

  for (const filePath of allFiles) {
    const lines = parseLines(filePath);

    for (const line of lines) {
      if (line.sessionId && !sessionId) sessionId = line.sessionId;
      if (line.cwd && !cwd) cwd = line.cwd;

      if (line.type === "assistant" || line.message?.role === "assistant") {
        turnCount++;

        // Collect conversation excerpt for classification
        if (excerptLength < EXCERPT_MAX) {
          const text = extractTextContent(line);
          if (text) {
            const remaining = EXCERPT_MAX - excerptLength;
            excerptParts.push(text.slice(0, remaining));
            excerptLength += text.length;
          }
        }

        const extracted = extractUsage(line);
        if (!extracted) continue;

        const { model, usage } = extracted;
        if (!models[model]) {
          models[model] = {
            model,
            inputTokens: 0,
            outputTokens: 0,
            cacheWrite5mTokens: 0,
            cacheWrite1hTokens: 0,
            cacheReadTokens: 0,
            reasoningOutputTokens: 0,
            cost: 0,
          };
        }
        const m = models[model];
        m.inputTokens += usage.input_tokens;
        m.outputTokens += usage.output_tokens;
        m.cacheWrite5mTokens += usage.ephemeral_5m_input_tokens;
        m.cacheWrite1hTokens += usage.ephemeral_1h_input_tokens;
        m.cacheReadTokens += usage.cache_read_input_tokens;
        m.reasoningOutputTokens += usage.reasoning_output_tokens;
        m.cost += calculateCost(model, usage);
      }

      // Also capture user messages for classification context
      if (
        (line.type === "human" || line.message?.role === "user") &&
        excerptLength < EXCERPT_MAX
      ) {
        const text = extractTextContent(line);
        if (text) {
          const remaining = EXCERPT_MAX - excerptLength;
          excerptParts.push(`[User]: ${text.slice(0, remaining)}`);
          excerptLength += text.length + 8;
        }
      }
    }
  }

  const totalCost = Object.values(models).reduce((sum, m) => sum + m.cost, 0);

  return {
    sessionId,
    cwd,
    provider: "anthropic" as Provider,
    models,
    totalCost,
    turnCount,
    conversationExcerpt: excerptParts.join("\n").slice(0, EXCERPT_MAX),
  };
}
