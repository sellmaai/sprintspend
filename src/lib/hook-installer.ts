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

const RULES_DIR = join(CLAUDE_DIR, "rules");
const RULES_PATH = join(RULES_DIR, "sprintspends.md");

const GLOBAL_RULES = `# SprintSpends - AI Cost Tracking

## Slash Commands

### /configure_linear

Set up SprintSpends for this developer. Run this in the terminal:
\`\`\`bash
sprintspends configure
\`\`\`

If \`sprintspends\` is not installed, install it first:
\`\`\`bash
git clone https://github.com/sellmaai/sprintspend.git ~/.sprintspends/app
cd ~/.sprintspends/app && npm install && npm run build && npm link
\`\`\`

Then run \`sprintspends configure\` from a repo that has \`.sprintspends.json\`.

### /sprintspends_status

Show the local AI cost summary by project. Run:
\`\`\`bash
sprintspends status
\`\`\`

### /sprintspends_sync

Force sync all unsynced costs to Linear. Run:
\`\`\`bash
sprintspends sync
\`\`\`
`;

export function installGlobalRules(): void {
  if (!existsSync(RULES_DIR)) {
    mkdirSync(RULES_DIR, { recursive: true });
  }
  writeFileSync(RULES_PATH, GLOBAL_RULES, "utf-8");
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
