export type Provider = "anthropic" | "openai";

// Hook input from Claude Code's Stop event (received on stdin)
export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
}

// Token usage from a single assistant message in the transcript
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
  reasoning_output_tokens: number;
}

// Aggregated usage per model across a session
export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  reasoningOutputTokens: number;
  cost: number;
}

// Result of parsing a full session transcript
export interface SessionUsage {
  sessionId: string;
  cwd: string;
  provider: Provider;
  models: Record<string, ModelUsage>;
  totalCost: number;
  turnCount: number;
  conversationExcerpt: string; // first ~2000 chars for classification
}

// Pricing for a single model (per million tokens)
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
  reasoningOutputPerMTok: number;
}

// Local config stored at ~/.sprintspends/config.json
export interface Config {
  linearAccessToken: string;
  linearUserId: string;
  logLevel?: "debug" | "verbose" | "info" | "error";
  classifierCli?: "claude" | "codex" | "auto";
}

// .sprintspends.json in the repo root (committed)
export interface RepoConfig {
  linearClientId: string;
}

// A single entry in the local ledger
export interface LedgerEntry {
  sessionId: string;
  timestamp: string;
  cwd: string;
  provider?: Provider;
  linearProjectId: string | null;
  linearProjectName: string | null;
  models: Record<string, ModelUsage>;
  totalCost: number;
  turnCount: number;
  lastTrackedTurnCount: number;
  syncedToLinear: boolean;
}

// The full ledger
export interface Ledger {
  version: number;
  entries: LedgerEntry[];
  projectTotals: Record<
    string,
    {
      totalCost: number;
      lastSyncedCost: number;
      lastSyncedAt: string | null;
    }
  >;
}
