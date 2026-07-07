import { findRepoConfig, updateConfig, loadConfig } from "../lib/config.js";
import { performOAuthFlow } from "../lib/oauth-server.js";
import { createLinearClient, getCurrentUser } from "../lib/linear.js";
import {
  installHook,
  installGlobalRules,
  installCodexHook,
  isCodexCliInstalled,
  isClaudeCliInstalled,
} from "../lib/hook-installer.js";
import { migrateLedger } from "../lib/ledger.js";
import { createInterface } from "node:readline";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function configure(cwd: string): Promise<void> {
  console.log("SprintSpends Configuration\n");

  // Step 1: Find client ID from repo config
  const repoConfig = findRepoConfig(cwd);
  let clientId: string;
  if (repoConfig?.linearClientId) {
    clientId = repoConfig.linearClientId;
    console.log(`Found Linear client ID from .sprintspends.json`);
  } else {
    clientId = await prompt(
      "No .sprintspends.json found. Enter Linear OAuth client ID: "
    );
    if (!clientId) {
      console.error("Client ID is required. Ask your org manager to set up .sprintspends.json");
      process.exit(1);
    }
  }

  // Step 2: OAuth flow
  const existing = loadConfig();
  let accessToken: string;
  if (existing?.linearAccessToken) {
    const reauth = await prompt("Linear already authorized. Re-authorize? (y/N): ");
    if (reauth.toLowerCase() === "y") {
      accessToken = await performOAuthFlow(clientId);
    } else {
      accessToken = existing.linearAccessToken;
    }
  } else {
    console.log("\nStep 1: Authorize with Linear");
    accessToken = await performOAuthFlow(clientId);
    console.log("Linear authorized successfully!");
  }

  // Validate token and get user
  const client = createLinearClient(accessToken);
  const user = await getCurrentUser(client);
  console.log(`\nLogged in as: ${user.name}`);

  // Step 3: Save config
  updateConfig({
    linearAccessToken: accessToken,
    linearUserId: user.id,
  });
  console.log("\nConfig saved to ~/.sprintspends/config.json");

  // Step 4: Migrate any old data
  const migrated = await migrateLedger();
  if (migrated) {
    console.log("\nMigrated ledger to latest format");
  }

  // Step 5: Install hooks for detected AI tools
  const hasClaude = isClaudeCliInstalled();
  const hasCodex = isCodexCliInstalled();

  if (hasClaude) {
    console.log("\nInstalling Claude Code hook...");
    installHook();
    console.log("Hook installed in ~/.claude/settings.json");

    // Install global slash commands for Claude Code
    installGlobalRules();
    console.log("Slash commands installed in ~/.claude/commands/");
  }

  if (hasCodex) {
    console.log("\nInstalling Codex hook...");
    installCodexHook();
    console.log("Hook installed in ~/.codex/hooks.json");
  }

  if (!hasClaude && !hasCodex) {
    console.log("\nWarning: Neither Claude Code nor Codex CLI detected.");
    console.log("Install at least one to track AI costs automatically.");
  }

  const tools = [hasClaude && "Claude Code", hasCodex && "Codex"].filter(Boolean).join(" and ");
  console.log(`\nSetup complete! SprintSpends will now:`);
  console.log(`  - Track AI costs from ${tools || "your AI coding tools"}`);
  console.log("  - Classify conversations to Linear projects");
  console.log("  - Post AI spend as a project update in Linear");
}
