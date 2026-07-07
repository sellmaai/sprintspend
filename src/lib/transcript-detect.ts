import { readFileSync, existsSync } from "node:fs";
import type { SessionUsage } from "../types.js";
import { parseTranscript } from "./transcript.js";
import { parseCodexTranscript } from "./transcript-codex.js";

/**
 * Auto-detect transcript format and parse accordingly.
 * Reads the first line to determine if it's a Codex or Claude Code transcript.
 */
export function parseAnyTranscript(transcriptPath: string): SessionUsage {
  if (!existsSync(transcriptPath)) {
    return parseTranscript(transcriptPath); // let it handle the missing file
  }

  const raw = readFileSync(transcriptPath, "utf-8");
  const firstLine = raw.split("\n")[0]?.trim();
  if (!firstLine) {
    return parseTranscript(transcriptPath);
  }

  try {
    const parsed = JSON.parse(firstLine);
    if (parsed.type === "session_meta" && parsed.payload?.model_provider === "openai") {
      return parseCodexTranscript(transcriptPath);
    }
  } catch {
    // Not valid JSON, fall through to Claude parser
  }

  return parseTranscript(transcriptPath);
}
