import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import lockfile from "proper-lockfile";
import { getConfigDir } from "./config.js";
import type { Ledger, LedgerEntry } from "../types.js";

const LEDGER_PATH = join(getConfigDir(), "ledger.json");
const LOCK_OPTIONS = { retries: { retries: 10, minTimeout: 200, maxTimeout: 5000 }, stale: 30000 };
const CURRENT_LEDGER_VERSION = 2;

function emptyLedger(): Ledger {
  return { version: CURRENT_LEDGER_VERSION, entries: [], projectTotals: {} };
}

function readLedger(): Ledger {
  if (!existsSync(LEDGER_PATH)) return emptyLedger();
  try {
    const raw = JSON.parse(readFileSync(LEDGER_PATH, "utf-8"));
    // Migrate from old format: issueTotals → projectTotals
    return {
      version: raw.version ?? 1,
      entries: raw.entries ?? [],
      projectTotals: raw.projectTotals ?? raw.issueTotals ?? {},
    };
  } catch {
    return emptyLedger();
  }
}

function writeLedger(ledger: Ledger): void {
  const dir = dirname(LEDGER_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf-8");
}

function ensureLedgerFile(): void {
  if (!existsSync(LEDGER_PATH)) {
    writeLedger(emptyLedger());
  }
}

export async function withLedger<T>(fn: (ledger: Ledger) => T | Promise<T>): Promise<T> {
  ensureLedgerFile();
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(LEDGER_PATH, LOCK_OPTIONS);
    const ledger = readLedger();
    const result = await fn(ledger);
    writeLedger(ledger);
    return result;
  } finally {
    if (release) await release();
  }
}

// Returns the previous project ID if the entry was reclassified to a different project
export async function addOrUpdateEntry(entry: LedgerEntry): Promise<string | null> {
  return withLedger((ledger) => {
    let previousProjectId: string | null = null;
    const existing = ledger.entries.findIndex(
      (e) => e.sessionId === entry.sessionId
    );

    if (existing >= 0) {
      const prev = ledger.entries[existing];
      if (prev.linearProjectId && ledger.projectTotals[prev.linearProjectId]) {
        ledger.projectTotals[prev.linearProjectId].totalCost = Math.max(
          0,
          ledger.projectTotals[prev.linearProjectId].totalCost - prev.totalCost
        );
      }
      // Detect reclassification: project changed from one to another
      if (
        prev.linearProjectId &&
        entry.linearProjectId &&
        prev.linearProjectId !== entry.linearProjectId
      ) {
        previousProjectId = prev.linearProjectId;
      }
      ledger.entries[existing] = entry;
    } else {
      ledger.entries.push(entry);
    }

    if (entry.linearProjectId) {
      if (!ledger.projectTotals[entry.linearProjectId]) {
        ledger.projectTotals[entry.linearProjectId] = {
          totalCost: 0,
          lastSyncedCost: 0,
          lastSyncedAt: null,
        };
      }
      ledger.projectTotals[entry.linearProjectId].totalCost += entry.totalCost;
    }

    return previousProjectId;
  });
}

export async function getUnsyncedDelta(projectId: string): Promise<number> {
  return withLedger((ledger) => {
    const totals = ledger.projectTotals[projectId];
    if (!totals) return 0;
    return totals.totalCost - totals.lastSyncedCost;
  });
}

export async function markSynced(
  projectId: string,
  syncedCost: number
): Promise<void> {
  await withLedger((ledger) => {
    if (!ledger.projectTotals[projectId]) return;
    ledger.projectTotals[projectId].lastSyncedCost = syncedCost;
    ledger.projectTotals[projectId].lastSyncedAt = new Date().toISOString();

    for (const entry of ledger.entries) {
      if (entry.linearProjectId === projectId) {
        entry.syncedToLinear = true;
      }
    }
  });
}

export async function getEntryBySessionId(
  sessionId: string
): Promise<LedgerEntry | null> {
  return withLedger((ledger) => {
    return ledger.entries.find((e) => e.sessionId === sessionId) ?? null;
  });
}

export async function getLedger(): Promise<Ledger> {
  ensureLedgerFile();
  return readLedger();
}

// Migrate old ledger format and clean up stale data
export async function migrateLedger(): Promise<boolean> {
  ensureLedgerFile();
  let migrated = false;

  await withLedger((ledger) => {
    if (ledger.version >= CURRENT_LEDGER_VERSION) return;

    // v1 → v2: clean up old issue-based entries, rebuild projectTotals
    if (ledger.version < 2) {
      const oldCount = ledger.entries.length;
      ledger.entries = ledger.entries.filter((e) => "linearProjectId" in e);
      if (ledger.entries.length !== oldCount) migrated = true;

      // Reset projectTotals to match current entries
      if (migrated) {
        ledger.projectTotals = {};
        for (const entry of ledger.entries) {
          if (entry.linearProjectId) {
            if (!ledger.projectTotals[entry.linearProjectId]) {
              ledger.projectTotals[entry.linearProjectId] = {
                totalCost: 0,
                lastSyncedCost: 0,
                lastSyncedAt: null,
              };
            }
            ledger.projectTotals[entry.linearProjectId].totalCost += entry.totalCost;
          }
        }
        // Assume previously tracked costs were already synced to avoid
        // re-syncing the full accumulated amount after migration
        for (const totals of Object.values(ledger.projectTotals)) {
          totals.lastSyncedCost = totals.totalCost;
        }
      }
    }

    ledger.version = CURRENT_LEDGER_VERSION;
    migrated = true;
  });

  return migrated;
}
