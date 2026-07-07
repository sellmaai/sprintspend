import { describe, it, expect } from "vitest";
import { parseCodexTranscript } from "../src/lib/transcript-codex.js";
import { parseAnyTranscript } from "../src/lib/transcript-detect.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("parseCodexTranscript", () => {
  it("parses a Codex session transcript correctly", () => {
    const result = parseCodexTranscript(join(FIXTURES, "codex-transcript.jsonl"));

    expect(result.sessionId).toBe("019da32b-test-session-id");
    expect(result.cwd).toBe("/Users/test/projects/myapp");
    expect(result.provider).toBe("openai");
    expect(result.turnCount).toBe(2);
    expect(result.totalCost).toBeGreaterThan(0);

    // Should have gpt-5.4 model
    expect(result.models["gpt-5.4"]).toBeDefined();
    const gpt = result.models["gpt-5.4"];
    // Turn 1: 5000 input, 1000 cached, 800 output, 200 reasoning
    // Turn 2: 8000 input, 5000 cached, 700 output, 200 reasoning
    expect(gpt.inputTokens).toBe(5000 + 8000);
    expect(gpt.outputTokens).toBe(800 + 700);
    expect(gpt.cacheReadTokens).toBe(1000 + 5000);
    expect(gpt.reasoningOutputTokens).toBe(200 + 200);
  });

  it("extracts conversation excerpt from assistant and user messages", () => {
    const result = parseCodexTranscript(join(FIXTURES, "codex-transcript.jsonl"));

    expect(result.conversationExcerpt).toContain("login bug");
    expect(result.conversationExcerpt).toContain("token validation");
    expect(result.conversationExcerpt.length).toBeLessThanOrEqual(2000);
  });

  it("returns zero cost for nonexistent transcript", () => {
    const result = parseCodexTranscript("/nonexistent/path.jsonl");

    expect(result.totalCost).toBe(0);
    expect(result.turnCount).toBe(0);
    expect(Object.keys(result.models)).toHaveLength(0);
  });
});

describe("parseAnyTranscript", () => {
  it("auto-detects Codex transcript and uses Codex parser", () => {
    const result = parseAnyTranscript(join(FIXTURES, "codex-transcript.jsonl"));

    expect(result.provider).toBe("openai");
    expect(result.sessionId).toBe("019da32b-test-session-id");
  });

  it("auto-detects Claude transcript and uses Claude parser", () => {
    const result = parseAnyTranscript(join(FIXTURES, "sample-transcript.jsonl"));

    expect(result.provider).toBe("anthropic");
    expect(result.sessionId).toBe("test-session-1");
  });
});
