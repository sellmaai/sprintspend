import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

const TRACK_COMMAND = "sprintspends track";
const CLASSIFY_COMMAND = "sprintspends classify";

interface HookEntry {
  type: string;
  command?: string;
  prompt?: string;
  async?: boolean;
  [key: string]: unknown;
}

interface ClaudeSettings {
  hooks?: Record<string, Array<{ matcher?: string; hooks: HookEntry[] }>>;
  [key: string]: unknown;
}

function isSprintSpendsHook(h: HookEntry): boolean {
  return (
    (h.type === "command" && (h.command === TRACK_COMMAND || h.command === CLASSIFY_COMMAND))
  );
}

export function installHook(): { alreadyInstalled: boolean } {
  if (!existsSync(CLAUDE_DIR)) {
    mkdirSync(CLAUDE_DIR, { recursive: true });
  }

  let settings: ClaudeSettings = {};
  if (existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } catch {
      // Start fresh if corrupted
    }
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Check if already installed
  const stopHooks = settings.hooks.Stop;
  if (stopHooks) {
    const hasSprintSpends = stopHooks.some((entry) =>
      entry.hooks.some(isSprintSpendsHook)
    );
    if (hasSprintSpends) return { alreadyInstalled: true };
  }

  // Add hooks: classify first (gets issue from Claude Code), then track (calculates cost + syncs)
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }

  // Command hook: classify the conversation using Claude Code's own LLM,
  // then track costs and sync to Linear
  settings.hooks.Stop.push({
    hooks: [
      {
        type: "command",
        command: CLASSIFY_COMMAND,
        async: true,
      },
      {
        type: "command",
        command: TRACK_COMMAND,
        async: true,
      },
    ],
  });

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  return { alreadyInstalled: false };
}

export function uninstallHook(): boolean {
  if (!existsSync(SETTINGS_PATH)) return false;

  const settings: ClaudeSettings = JSON.parse(
    readFileSync(SETTINGS_PATH, "utf-8")
  );
  if (!settings.hooks?.Stop) return false;

  const before = settings.hooks.Stop.length;
  settings.hooks.Stop = settings.hooks.Stop.filter(
    (entry) => !entry.hooks.some(isSprintSpendsHook)
  );

  if (settings.hooks.Stop.length === 0) {
    delete settings.hooks.Stop;
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  return settings.hooks.Stop?.length !== before;
}

export function isInstalled(): boolean {
  if (!existsSync(SETTINGS_PATH)) return false;
  try {
    const settings: ClaudeSettings = JSON.parse(
      readFileSync(SETTINGS_PATH, "utf-8")
    );
    return (
      settings.hooks?.Stop?.some((entry) =>
        entry.hooks.some(isSprintSpendsHook)
      ) ?? false
    );
  } catch {
    return false;
  }
}
