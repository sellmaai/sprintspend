import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Config, RepoConfig } from "../types.js";

const CONFIG_DIR = join(homedir(), ".sprintspends");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function updateConfig(partial: Partial<Config>): Config {
  const existing = loadConfig() ?? {
    linearAccessToken: "",
    linearCustomFieldId: "",
    linearUserId: "",
  };
  const updated = { ...existing, ...partial };
  saveConfig(updated);
  return updated;
}

// Find .sprintspends.json in the repo by walking up from cwd
export function findRepoConfig(startDir: string): RepoConfig | null {
  let dir = resolve(startDir);
  const root = resolve("/");

  while (dir !== root) {
    const configPath = join(dir, ".sprintspends.json");
    if (existsSync(configPath)) {
      try {
        return JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        return null;
      }
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
