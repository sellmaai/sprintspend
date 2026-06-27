import { describe, it, expect } from "vitest";

// Test the claude -p response parsing logic in isolation
function parseClassificationResponse(result: string): { project: string | null; confidence: string } | null {
  let parsed: { project: string | null; confidence: string };
  try {
    const jsonResponse = JSON.parse(result.trim());
    const text = jsonResponse.result ?? jsonResponse.content ?? result;
    const match = typeof text === "string" ? text.match(/\{[^}]+\}/) : null;
    parsed = match ? JSON.parse(match[0]) : JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
  } catch {
    const match = result.match(/\{[^}]+\}/);
    if (!match) return null;
    parsed = JSON.parse(match[0]);
  }
  return parsed;
}

describe("classification response parsing", () => {
  it("parses claude -p JSON output format", () => {
    const response = JSON.stringify({
      type: "result",
      subtype: "success",
      result: '{"project": "Simulation Engine", "confidence": "high"}',
    });

    const parsed = parseClassificationResponse(response);
    expect(parsed).toEqual({ project: "Simulation Engine", confidence: "high" });
  });

  it("parses when result contains extra text around JSON", () => {
    const response = JSON.stringify({
      type: "result",
      result: 'Based on the conversation, {"project": "UI Updates", "confidence": "low"} is the best match.',
    });

    const parsed = parseClassificationResponse(response);
    expect(parsed).toEqual({ project: "UI Updates", confidence: "low" });
  });

  it("parses direct JSON response (no wrapper)", () => {
    const response = '{"project": "Public Website", "confidence": "high"}';

    const parsed = parseClassificationResponse(response);
    expect(parsed).toEqual({ project: "Public Website", confidence: "high" });
  });

  it("handles null project (unclassified)", () => {
    const response = JSON.stringify({
      type: "result",
      result: '{"project": null, "confidence": "none"}',
    });

    const parsed = parseClassificationResponse(response);
    expect(parsed).toEqual({ project: null, confidence: "none" });
  });

  it("returns null for garbage input", () => {
    const parsed = parseClassificationResponse("not json at all");
    expect(parsed).toBeNull();
  });

  it("handles result field that is already an object", () => {
    // Edge case: what if result is not a string but an object?
    const response = JSON.stringify({
      type: "result",
      result: { project: "Test", confidence: "high" },
    });

    // result is an object, not string. text = object. match on non-string = null.
    // Falls to: JSON.parse(JSON.stringify(text))
    const parsed = parseClassificationResponse(response);
    expect(parsed).toEqual({ project: "Test", confidence: "high" });
  });

  it("parses real claude -p output format", () => {
    // This is the actual format from claude -p --output-format json
    const response = '{"type":"result","subtype":"success","is_error":false,"duration_ms":2082,"duration_api_ms":1969,"num_turns":1,"result":"{\\"project\\": \\"Simulation Engine\\", \\"confidence\\": \\"high\\"}","stop_reason":"end_turn","session_id":"af8a9813-146e-483c-8cc8-3b3890a44c0b","total_cost_usd":0.07}';

    const parsed = parseClassificationResponse(response);
    expect(parsed).toEqual({ project: "Simulation Engine", confidence: "high" });
  });

  it("handles result with markdown code block", () => {
    const response = JSON.stringify({
      type: "result",
      result: '```json\n{"project": "Persona Data Pipeline", "confidence": "high"}\n```',
    });

    const parsed = parseClassificationResponse(response);
    expect(parsed).toEqual({ project: "Persona Data Pipeline", confidence: "high" });
  });
});
