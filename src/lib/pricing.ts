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
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWrite5mPerMTok: 3.75,
    cacheWrite1hPerMTok: 6,
    cacheReadPerMTok: 0.3,
  },
  "claude-haiku-4-5": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWrite5mPerMTok: 1.25,
    cacheWrite1hPerMTok: 2,
    cacheReadPerMTok: 0.1,
  },
};

// Aliases for model name variations
const MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-8": "claude-opus-4-6",
  "claude-opus-4-7": "claude-opus-4-6",
  "claude-sonnet-4-5": "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

function resolvePricing(model: string): ModelPricing {
  const resolved = MODEL_ALIASES[model] ?? model;
  const pricing = PRICING_TABLE[resolved];
  if (pricing) return pricing;

  // Try prefix matching (e.g. "claude-sonnet-4-6-20260301")
  for (const [key, value] of Object.entries(PRICING_TABLE)) {
    if (model.startsWith(key)) return value;
  }

  // Fall back to opus pricing (most expensive = conservative estimate)
  return PRICING_TABLE["claude-opus-4-6"];
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const pricing = resolvePricing(model);
  const perToken = (perMTok: number) => perMTok / 1_000_000;

  return (
    usage.input_tokens * perToken(pricing.inputPerMTok) +
    usage.output_tokens * perToken(pricing.outputPerMTok) +
    usage.ephemeral_5m_input_tokens * perToken(pricing.cacheWrite5mPerMTok) +
    usage.ephemeral_1h_input_tokens * perToken(pricing.cacheWrite1hPerMTok) +
    usage.cache_read_input_tokens * perToken(pricing.cacheReadPerMTok)
  );
}
