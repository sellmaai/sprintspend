import { readFileSync, existsSync } from "node:fs";
import type { SessionUsage, ModelUsage, TokenUsage } from "../types.js";
import { calculateCost } from "./pricing.js";

// Codex JSONL line types we care about
interface CodexLine {
  type?: string;
  payload?: {
    // session_meta
    id?: string;
    cwd?: string;
    model_provider?: string;
    // turn_context
    turn_id?: string;
    model?: string;
    // event_msg payload
    type?: string;
    info?: {
      last_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
      };
    } | null;
    rate_limits?: {
      plan_type?: string;
    };
    // response_item payload
    role?: string;
    content?: Array<{ type?: string; text?: string; output_text?: string; input_text?: string }>;
    phase?: string;
  };
}

function parseLines(filePath: string): CodexLine[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf-8");
  const lines: CodexLine[] = [];
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

function extractText(content: CodexLine["payload"]): string {
  if (!content?.content) return "";
  return content.content
    .map((c) => c.text ?? c.output_text ?? c.input_text ?? "")
    .filter(Boolean)
    .join(" ");
}

export function parseCodexTranscript(transcriptPath: string): SessionUsage {
  const lines = parseLines(transcriptPath);
  const models: Record<string, ModelUsage> = {};
  let sessionId = "";
  let cwd = "";
  let currentModel = "";
  let turnCount = 0;
  const excerptParts: string[] = [];
  let excerptLength = 0;
  const EXCERPT_MAX = 2000;

  for (const line of lines) {
    // Extract session metadata
    if (line.type === "session_meta" && line.payload) {
      if (line.payload.id) sessionId = line.payload.id;
      if (line.payload.cwd) cwd = line.payload.cwd;
    }

    // Track current model from turn_context
    if (line.type === "turn_context" && line.payload?.model) {
      currentModel = line.payload.model;
    }

    // Count turns from task_started events
    if (line.type === "event_msg" && line.payload?.type === "task_started") {
      turnCount++;
    }

    // Extract token usage from token_count events
    if (line.type === "event_msg" && line.payload?.type === "token_count") {
      const lastUsage = line.payload.info?.last_token_usage;
      if (!lastUsage || !currentModel) continue;

      const usage: TokenUsage = {
        input_tokens: lastUsage.input_tokens ?? 0,
        output_tokens: lastUsage.output_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: lastUsage.cached_input_tokens ?? 0,
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 0,
        reasoning_output_tokens: lastUsage.reasoning_output_tokens ?? 0,
      };

      // Skip if no actual tokens
      if (usage.input_tokens === 0 && usage.output_tokens === 0) continue;

      if (!models[currentModel]) {
        models[currentModel] = {
          model: currentModel,
          inputTokens: 0,
          outputTokens: 0,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 0,
          reasoningOutputTokens: 0,
          cost: 0,
        };
      }
      const m = models[currentModel];
      m.inputTokens += usage.input_tokens;
      m.outputTokens += usage.output_tokens;
      m.cacheReadTokens += usage.cache_read_input_tokens;
      m.reasoningOutputTokens += usage.reasoning_output_tokens;
      m.cost += calculateCost(currentModel, usage);
    }

    // Collect conversation excerpts from assistant messages
    if (
      line.type === "response_item" &&
      line.payload?.role === "assistant" &&
      excerptLength < EXCERPT_MAX
    ) {
      const text = extractText(line.payload);
      if (text) {
        const remaining = EXCERPT_MAX - excerptLength;
        excerptParts.push(text.slice(0, remaining));
        excerptLength += text.length;
      }
    }

    // Also capture user messages for classification context
    if (
      line.type === "response_item" &&
      line.payload?.role === "user" &&
      excerptLength < EXCERPT_MAX
    ) {
      const text = extractText(line.payload);
      if (text) {
        const remaining = EXCERPT_MAX - excerptLength;
        excerptParts.push(`[User]: ${text.slice(0, remaining)}`);
        excerptLength += text.length + 8;
      }
    }

    // Also capture commentary messages from the agent
    if (
      line.type === "event_msg" &&
      line.payload?.type === "agent_message" &&
      excerptLength < EXCERPT_MAX
    ) {
      const msg = (line.payload as unknown as { message?: string }).message;
      if (msg) {
        const remaining = EXCERPT_MAX - excerptLength;
        excerptParts.push(msg.slice(0, remaining));
        excerptLength += msg.length;
      }
    }
  }

  const totalCost = Object.values(models).reduce((sum, m) => sum + m.cost, 0);

  return {
    sessionId,
    cwd,
    provider: "openai",
    models,
    totalCost,
    turnCount,
    conversationExcerpt: excerptParts.join("\n").slice(0, EXCERPT_MAX),
  };
}
