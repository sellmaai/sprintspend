import type { ModelPricing, TokenUsage } from "../types.js";

// Anthropic model pricing (per million tokens)
// Source: https://docs.anthropic.com/en/docs/about-claude/models
const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-opus-4-6": {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheWrite5mPerMTok: 6.25,
    cacheWrite1hPerMTok: 10,
    cacheReadPerMTok: 0.5,
    reasoningOutputPerMTok: 0,
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6,
    cacheReadPerMTok: 0.3,
    reasoningOutputPerMTok: 0,
  },
  "claude-haiku-4-5": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWrite5mPerMTok: 1.25,
    cacheWrite1hPerMTok: 2,
    cacheReadPerMTok: 0.1,
    reasoningOutputPerMTok: 0,
  },

  // OpenAI model pricing (per million tokens)
  // Source: https://developers.openai.com/codex/pricing
  "gpt-5.3-codex": {
    inputPerMTok: 1.75,
    outputPerMTok: 14,
    cacheWrite5mPerMTok: 0,
    cacheWrite1hPerMTok: 0,
    cacheReadPerMTok: 0.175,
    reasoningOutputPerMTok: 14,
  },
  "gpt-5.4": {
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 0,
    cacheWrite1hPerMTok: 0,
    cacheReadPerMTok: 0.25,
    reasoningOutputPerMTok: 15,
  },
  "o4-mini": {
    inputPerMTok: 1.1,
    outputPerMTok: 4.4,
    cacheWrite5mPerMTok: 0,
    cacheWrite1hPerMTok: 0,
    cacheReadPerMTok: 0.275,
    reasoningOutputPerMTok: 4.4,
  },
  "o3-mini": {
    inputPerMTok: 1.1,
    outputPerMTok: 4.4,
    cacheWrite5mPerMTok: 0,
    cacheWrite1hPerMTok: 0,
    cacheReadPerMTok: 0.275,
    reasoningOutputPerMTok: 4.4,
  },
};

// Aliases for model name variations
const MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-8": "claude-opus-4-6",
  "claude-opus-4-7": "claude-opus-4-6",
  "claude-sonnet-4-5": "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

// Default fallback pricing by provider
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  anthropic: PRICING_TABLE["claude-opus-4-6"],
  openai: PRICING_TABLE["gpt-5.4"],
};

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o3") || model.startsWith("o4");
}

function resolvePricing(model: string): ModelPricing {
  const resolved = MODEL_ALIASES[model] ?? model;
  const pricing = PRICING_TABLE[resolved];
  if (pricing) return pricing;

  // Try prefix matching (e.g. "claude-sonnet-4-6-20260301" or "gpt-5.4-20260401")
  for (const [key, value] of Object.entries(PRICING_TABLE)) {
    if (model.startsWith(key)) return value;
  }

  // Fall back to most expensive model for the provider (conservative estimate)
  return isOpenAIModel(model)
    ? FALLBACK_PRICING.openai
    : FALLBACK_PRICING.anthropic;
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = resolvePricing(model);
  const perToken = (perMTok: number) => perMTok / 1_000_000;

  return (
    usage.input_tokens * perToken(pricing.inputPerMTok) +
    usage.output_tokens * perToken(pricing.outputPerMTok) +
    usage.ephemeral_5m_input_tokens * perToken(pricing.cacheWrite5mPerMTok) +
    usage.ephemeral_1h_input_tokens * perToken(pricing.cacheWrite1hPerMTok) +
    usage.cache_read_input_tokens * perToken(pricing.cacheReadPerMTok) +
    usage.reasoning_output_tokens * perToken(pricing.reasoningOutputPerMTok)
  );
}
