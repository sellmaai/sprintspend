import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");
const CODEX_DIR = join(homedir(), ".codex");

const TRACK_COMMAND = "sprintspends track";

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

const OLD_CLASSIFY_COMMAND = "sprintspends classify";

function isSprintSpendsHook(h: HookEntry): boolean {
  return (
    h.type === "command" &&
    (h.command === TRACK_COMMAND || h.command === OLD_CLASSIFY_COMMAND)
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

  // Remove any old sprintspends hooks (including outdated classify hook)
  if (settings.hooks.Stop) {
    settings.hooks.Stop = settings.hooks.Stop.filter(
      (entry) => !entry.hooks.some(isSprintSpendsHook)
    );
    if (settings.hooks.Stop.length === 0) {
      delete settings.hooks.Stop;
    }
  }

  // Install the current single hook
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }

  settings.hooks.Stop.push({
    hooks: [
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

const COMMANDS_DIR = join(CLAUDE_DIR, "commands");

const COMMANDS: Record<string, string> = {
  "configure_linear.md": `Set up SprintSpends for this developer. Run this single command to install (or update) and configure:

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/sellmaai/sprintspend/main/install.sh | bash
\`\`\`
`,
  "sprintspends_status.md": `Show the local AI cost summary by project.

\`\`\`bash
sprintspends status
\`\`\`
`,
  "sprintspends_sync.md": `Force sync all unsynced costs to Linear.

\`\`\`bash
sprintspends sync
\`\`\`
`,
};

// Legacy rules file cleanup
const RULES_DIR = join(CLAUDE_DIR, "rules");
const OLD_RULES_PATH = join(RULES_DIR, "sprintspends.md");

export function installGlobalRules(): void {
  // Install as proper slash commands
  if (!existsSync(COMMANDS_DIR)) {
    mkdirSync(COMMANDS_DIR, { recursive: true });
  }
  for (const [filename, content] of Object.entries(COMMANDS)) {
    writeFileSync(join(COMMANDS_DIR, filename), content, "utf-8");
  }

  // Remove legacy rules file if it exists
  if (existsSync(OLD_RULES_PATH)) {
    const { unlinkSync } = require("node:fs");
    unlinkSync(OLD_RULES_PATH);
  }
}

export function isClaudeInstalled(): boolean {
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

// Keep old name as alias for backward compatibility
export const isInstalled = isClaudeInstalled;

// --- Codex hook support ---
// Codex hooks.json uses the same nested format as Claude Code:
// { hooks: { EventName: [{ matcher?, hooks: [{ type, command }] }] } }

interface CodexHookEntry {
  type: string;
  command: string | string[];
  timeout?: number;
  [key: string]: unknown;
}

interface CodexHooksConfig {
  hooks?: Record<string, Array<{ matcher?: string | null; hooks: CodexHookEntry[] }>>;
  [key: string]: unknown;
}

const CODEX_HOOKS_PATH = join(CODEX_DIR, "hooks.json");
const CODEX_TRACK_COMMAND = "sprintspends track --codex";

function isSprintSpendsCodexHook(h: CodexHookEntry): boolean {
  const cmd = Array.isArray(h.command) ? h.command.join(" ") : h.command;
  return cmd.includes("sprintspends");
}

export function installCodexHook(): { alreadyInstalled: boolean } {
  if (!existsSync(CODEX_DIR)) {
    mkdirSync(CODEX_DIR, { recursive: true });
  }

  let config: CodexHooksConfig = {};
  if (existsSync(CODEX_HOOKS_PATH)) {
    try {
      config = JSON.parse(readFileSync(CODEX_HOOKS_PATH, "utf-8"));
    } catch {
      // Start fresh if corrupted
    }
  }

  if (!config.hooks) {
    config.hooks = {};
  }

  // Remove any old sprintspends hooks from all events
  for (const event of Object.keys(config.hooks)) {
    config.hooks[event] = config.hooks[event].filter(
      (entry) => !entry.hooks.some(isSprintSpendsCodexHook)
    );
    if (config.hooks[event].length === 0) {
      delete config.hooks[event];
    }
  }

  // Install the track hook on PostToolUse
  if (!config.hooks.PostToolUse) {
    config.hooks.PostToolUse = [];
  }

  config.hooks.PostToolUse.push({
    hooks: [
      {
        type: "command",
        command: CODEX_TRACK_COMMAND,
        timeout: 30,
      },
    ],
  });

  writeFileSync(CODEX_HOOKS_PATH, JSON.stringify(config, null, 2), "utf-8");
  return { alreadyInstalled: false };
}

export function uninstallCodexHook(): boolean {
  if (!existsSync(CODEX_HOOKS_PATH)) return false;

  const config: CodexHooksConfig = JSON.parse(
    readFileSync(CODEX_HOOKS_PATH, "utf-8")
  );
  if (!config.hooks?.PostToolUse) return false;

  const before = config.hooks.PostToolUse.length;
  config.hooks.PostToolUse = config.hooks.PostToolUse.filter(
    (entry) => !entry.hooks.some(isSprintSpendsCodexHook)
  );

  if (config.hooks.PostToolUse.length === 0) {
    delete config.hooks.PostToolUse;
  }

  writeFileSync(CODEX_HOOKS_PATH, JSON.stringify(config, null, 2), "utf-8");
  return config.hooks.PostToolUse?.length !== before;
}

export function isCodexHookInstalled(): boolean {
  if (!existsSync(CODEX_HOOKS_PATH)) return false;
  try {
    const config: CodexHooksConfig = JSON.parse(
      readFileSync(CODEX_HOOKS_PATH, "utf-8")
    );
    return (
      config.hooks?.PostToolUse?.some((entry) =>
        entry.hooks.some(isSprintSpendsCodexHook)
      ) ?? false
    );
  } catch {
    return false;
  }
}

export function isCodexCliInstalled(): boolean {
  try {
    execFileSync("which", ["codex"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function isClaudeCliInstalled(): boolean {
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
