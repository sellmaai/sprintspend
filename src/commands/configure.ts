import { findRepoConfig, updateConfig, loadConfig } from "../lib/config.js";
import { performOAuthFlow } from "../lib/oauth-server.js";
import { createLinearClient, getCurrentUser } from "../lib/linear.js";
import { installHook } from "../lib/hook-installer.js";
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

  // Step 4: Install Claude Code hook
  console.log("\nStep 2: Installing Claude Code hook...");
  const hookResult = installHook();
  if (hookResult.alreadyInstalled) {
    console.log("Hook already installed in ~/.claude/settings.json");
  } else {
    console.log("Hook installed in ~/.claude/settings.json");
  }

  console.log("\nSetup complete! SprintSpends will now:");
  console.log("  - Track AI costs on every Claude Code turn");
  console.log("  - Classify conversations to Linear issues (using Claude Code's own LLM)");
  console.log("  - Post AI spend as a comment on matched Linear issues");
}
