import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CLAUDE_DIR = join(homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

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
