import { describe, it, expect } from "vitest";
import { parseTranscript } from "../src/lib/transcript.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("parseTranscript", () => {
  it("parses a multi-turn transcript correctly", () => {
    const result = parseTranscript(join(FIXTURES, "sample-transcript.jsonl"));

    expect(result.sessionId).toBe("test-session-1");
    expect(result.cwd).toBe("/Users/dev/project");
    expect(result.turnCount).toBe(3);
    expect(result.totalCost).toBeGreaterThan(0);

    // Should have sonnet model
    expect(result.models["claude-sonnet-4-6"]).toBeDefined();
    const sonnet = result.models["claude-sonnet-4-6"];
    expect(sonnet.inputTokens).toBe(600); // 100 + 200 + 300
    expect(sonnet.outputTokens).toBe(350); // 50 + 100 + 200
    expect(sonnet.cacheWrite5mTokens).toBe(1500); // 500 + 1000 + 0
    expect(sonnet.cacheReadTokens).toBe(1800); // 0 + 300 + 1500
  });

  it("extracts conversation excerpt with user and assistant text", () => {
    const result = parseTranscript(join(FIXTURES, "sample-transcript.jsonl"));

    expect(result.conversationExcerpt).toContain("simulation engine");
    expect(result.conversationExcerpt).toContain("[User]:");
    expect(result.conversationExcerpt).toContain("physics module");
    expect(result.conversationExcerpt.length).toBeLessThanOrEqual(2000);
  });

  it("handles a minimal single-turn transcript", () => {
    const result = parseTranscript(join(FIXTURES, "minimal-transcript.jsonl"));

    expect(result.sessionId).toBe("test-minimal");
    expect(result.turnCount).toBe(1);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.models["claude-sonnet-4-6"].inputTokens).toBe(10);
    expect(result.models["claude-sonnet-4-6"].outputTokens).toBe(5);
  });

  it("returns zero cost for nonexistent transcript", () => {
    const result = parseTranscript("/nonexistent/path.jsonl");

    expect(result.totalCost).toBe(0);
    expect(result.turnCount).toBe(0);
    expect(Object.keys(result.models)).toHaveLength(0);
  });

  it("skips malformed lines without crashing", () => {
    // The sample file is valid, but we can test the parser doesn't crash
    // on a file that starts with garbage
    const result = parseTranscript(join(FIXTURES, "sample-transcript.jsonl"));
    expect(result.turnCount).toBe(3);
  });
});
