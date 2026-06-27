import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to mock the config dir before importing ledger
const TEST_DIR = join(tmpdir(), `sprintspends-test-${Date.now()}`);
const LEDGER_PATH = join(TEST_DIR, "ledger.json");

// Mock getConfigDir
import { vi } from "vitest";
vi.mock("../src/lib/config.js", () => ({
  getConfigDir: () => TEST_DIR,
}));

// Import after mock
const { addOrUpdateEntry, getEntryBySessionId, getUnsyncedDelta, markSynced, getLedger, migrateLedger } = await import("../src/lib/ledger.js");

import type { LedgerEntry } from "../src/types.js";

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    cwd: "/test",
    linearProjectId: null,
    linearProjectName: null,
    models: {},
    totalCost: 1.5,
    turnCount: 5,
    lastTrackedTurnCount: 5,
    syncedToLinear: false,
    ...overrides,
  };
}

describe("ledger", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    if (existsSync(LEDGER_PATH)) rmSync(LEDGER_PATH);
    // Also remove lock file
    const lockPath = LEDGER_PATH + ".lock";
    if (existsSync(lockPath)) rmSync(lockPath, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates ledger file on first access", async () => {
    const ledger = await getLedger();
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.projectTotals).toEqual({});
  });

  it("adds a new entry", async () => {
    const entry = makeEntry();
    await addOrUpdateEntry(entry);

    const ledger = await getLedger();
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].sessionId).toBe("session-1");
    expect(ledger.entries[0].totalCost).toBe(1.5);
  });

  it("updates existing entry by sessionId", async () => {
    await addOrUpdateEntry(makeEntry({ totalCost: 1.0 }));
    await addOrUpdateEntry(makeEntry({ totalCost: 2.5 }));

    const ledger = await getLedger();
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].totalCost).toBe(2.5);
  });

  it("tracks project totals when projectId is set", async () => {
    await addOrUpdateEntry(
      makeEntry({
        linearProjectId: "proj-1",
        linearProjectName: "My Project",
        totalCost: 3.0,
      })
    );

    const ledger = await getLedger();
    expect(ledger.projectTotals["proj-1"]).toBeDefined();
    expect(ledger.projectTotals["proj-1"].totalCost).toBe(3.0);
  });

  it("updates project totals correctly on entry update", async () => {
    await addOrUpdateEntry(
      makeEntry({
        linearProjectId: "proj-1",
        linearProjectName: "My Project",
        totalCost: 2.0,
      })
    );
    await addOrUpdateEntry(
      makeEntry({
        linearProjectId: "proj-1",
        linearProjectName: "My Project",
        totalCost: 5.0,
      })
    );

    const ledger = await getLedger();
    expect(ledger.projectTotals["proj-1"].totalCost).toBe(5.0);
  });

  it("tracks unsynced delta", async () => {
    await addOrUpdateEntry(
      makeEntry({
        linearProjectId: "proj-1",
        linearProjectName: "My Project",
        totalCost: 3.0,
      })
    );

    const delta = await getUnsyncedDelta("proj-1");
    expect(delta).toBe(3.0);
  });

  it("marks synced and updates delta", async () => {
    await addOrUpdateEntry(
      makeEntry({
        linearProjectId: "proj-1",
        linearProjectName: "My Project",
        totalCost: 3.0,
      })
    );

    await markSynced("proj-1", 3.0);

    const delta = await getUnsyncedDelta("proj-1");
    expect(delta).toBe(0);

    const ledger = await getLedger();
    expect(ledger.entries[0].syncedToLinear).toBe(true);
  });

  it("finds entry by session ID", async () => {
    await addOrUpdateEntry(makeEntry({ sessionId: "abc" }));
    await addOrUpdateEntry(makeEntry({ sessionId: "def", totalCost: 9.0 }));

    const found = await getEntryBySessionId("def");
    expect(found).not.toBeNull();
    expect(found!.totalCost).toBe(9.0);
  });

  it("returns null for unknown session ID", async () => {
    const found = await getEntryBySessionId("nonexistent");
    expect(found).toBeNull();
  });

  it("migrates old issueTotals format", async () => {
    // Write old format ledger
    writeFileSync(
      LEDGER_PATH,
      JSON.stringify({
        entries: [
          {
            sessionId: "old-1",
            linearIssueId: "issue-1",
            totalCost: 5.0,
          },
        ],
        issueTotals: {
          "issue-1": { totalCost: 5.0, lastSyncedCost: 0, lastSyncedAt: null },
        },
      })
    );

    // migrateLedger should clean up old entries (no linearProjectId field)
    const migrated = await migrateLedger();
    expect(migrated).toBe(true);

    const ledger = await getLedger();
    // Old entries without linearProjectId should be removed
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.projectTotals).toEqual({});
  });

  it("handles multiple sessions for same project", async () => {
    await addOrUpdateEntry(
      makeEntry({
        sessionId: "s1",
        linearProjectId: "proj-1",
        linearProjectName: "Proj",
        totalCost: 2.0,
      })
    );
    await addOrUpdateEntry(
      makeEntry({
        sessionId: "s2",
        linearProjectId: "proj-1",
        linearProjectName: "Proj",
        totalCost: 3.0,
      })
    );

    const ledger = await getLedger();
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.projectTotals["proj-1"].totalCost).toBe(5.0);
  });
});
