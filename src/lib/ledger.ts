import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import lockfile from "proper-lockfile";
import { getConfigDir } from "./config.js";
import type { Ledger, LedgerEntry } from "../types.js";

const LEDGER_PATH = join(getConfigDir(), "ledger.json");
const LOCK_OPTIONS = { retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 } };

function emptyLedger(): Ledger {
  return { entries: [], projectTotals: {} };
}

function readLedger(): Ledger {
  if (!existsSync(LEDGER_PATH)) return emptyLedger();
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf-8"));
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

export async function withLedger<T>(fn: (ledger: Ledger) => T): Promise<T> {
  ensureLedgerFile();
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(LEDGER_PATH, LOCK_OPTIONS);
    const ledger = readLedger();
    const result = fn(ledger);
    writeLedger(ledger);
    return result;
  } finally {
    if (release) await release();
  }
}

export async function addOrUpdateEntry(entry: LedgerEntry): Promise<void> {
  await withLedger((ledger) => {
    const existing = ledger.entries.findIndex(
      (e) => e.sessionId === entry.sessionId
    );

    if (existing >= 0) {
      const prev = ledger.entries[existing];
      if (prev.linearProjectId && ledger.projectTotals[prev.linearProjectId]) {
        ledger.projectTotals[prev.linearProjectId].totalCost -= prev.totalCost;
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
