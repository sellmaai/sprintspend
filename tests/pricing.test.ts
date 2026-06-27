import { describe, it, expect } from "vitest";
import { calculateCost } from "../src/lib/pricing.js";
import type { TokenUsage } from "../src/types.js";

describe("calculateCost", () => {
  it("calculates cost for sonnet with all token types", () => {
    const usage: TokenUsage = {
      input_tokens: 1_000_000, // $3
      output_tokens: 1_000_000, // $15
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000, // $0.30
      ephemeral_5m_input_tokens: 1_000_000, // $3.75
      ephemeral_1h_input_tokens: 0,
    };

    const cost = calculateCost("claude-sonnet-4-6", usage);
    expect(cost).toBeCloseTo(3 + 15 + 3.75 + 0.30, 2);
  });

  it("calculates cost for opus", () => {
    const usage: TokenUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };

    const cost = calculateCost("claude-opus-4-6", usage);
    expect(cost).toBeCloseTo(5 + 25, 2);
  });

  it("calculates cost for haiku", () => {
    const usage: TokenUsage = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };

    const cost = calculateCost("claude-haiku-4-5", usage);
    expect(cost).toBeCloseTo(1 + 5, 2);
  });

  it("handles model aliases", () => {
    const usage: TokenUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };

    expect(calculateCost("claude-haiku-4-5-20251001", usage)).toBeCloseTo(1, 2);
  });

  it("handles versioned model names via prefix matching", () => {
    const usage: TokenUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };

    expect(calculateCost("claude-sonnet-4-6-20260301", usage)).toBeCloseTo(3, 2);
  });

  it("falls back to opus pricing for unknown models", () => {
    const usage: TokenUsage = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };

    expect(calculateCost("unknown-model", usage)).toBeCloseTo(5, 2);
  });

  it("returns zero cost for zero tokens", () => {
    const usage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };

    expect(calculateCost("claude-sonnet-4-6", usage)).toBe(0);
  });

  it("handles 1h cache write tokens", () => {
    const usage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 1_000_000, // $6 for sonnet
    };

    expect(calculateCost("claude-sonnet-4-6", usage)).toBeCloseTo(6, 2);
  });
});
