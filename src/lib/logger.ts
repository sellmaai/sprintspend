import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { getConfigDir } from "./config.js";

export type LogLevel = "debug" | "verbose" | "info" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  verbose: 1,
  info: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

// Initialize log level from config or env var
export function initLogLevel(): void {
  // Env var takes precedence
  const envLevel = process.env.SPRINTSPENDS_LOG_LEVEL;
  if (envLevel && envLevel in LEVEL_PRIORITY) {
    currentLevel = envLevel as LogLevel;
    return;
  }

  // Read from config file
  try {
    const configPath = join(getConfigDir(), "config.json");
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      if (config.logLevel && config.logLevel in LEVEL_PRIORITY) {
        currentLevel = config.logLevel as LogLevel;
      }
    }
  } catch {
    // Keep default
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function writeLog(level: LogLevel, message: string): void {
  if (!shouldLog(level)) return;

  const logPath = join(getConfigDir(), "sprintspends.log");
  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(7);
  appendFileSync(logPath, `[${timestamp}] ${tag} ${message}\n`, "utf-8");
}

export const log = {
  debug: (message: string) => writeLog("debug", message),
  verbose: (message: string) => writeLog("verbose", message),
  info: (message: string) => writeLog("info", message),
  error: (message: string, error?: unknown) => {
    const errStr = error instanceof Error
      ? `${error.message}\n${error.stack}`
      : error ? String(error) : "";
    writeLog("error", errStr ? `${message} ${errStr}` : message);
  },
};
