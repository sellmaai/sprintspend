import { Command } from "commander";
import { configure } from "./commands/configure.js";
import { track } from "./commands/track.js";
import { status } from "./commands/status.js";
import { sync } from "./commands/sync.js";
import { updateConfig, loadConfig } from "./lib/config.js";
import type { Config } from "./types.js";

const program = new Command();

program
  .name("sprintspends")
  .description("AI cost tracking for Linear via Claude Code and Codex hooks")
  .version("0.1.0");

program
  .command("configure")
  .description("Set up Linear OAuth and install hooks for Claude Code and Codex")
  .action(async () => {
    await configure(process.cwd());
  });

program
  .command("track")
  .description("Track costs from a Claude Code or Codex session (called by hook)")
  .option("--codex", "Track from latest Codex session (used by Codex hook)")
  .action(async (opts: { codex?: boolean }) => {
    await track(opts);
  });

program
  .command("status")
  .description("Show local cost summary by project")
  .action(async () => {
    await status();
  });

program
  .command("sync")
  .description("Force sync all unsynced costs to Linear")
  .action(async () => {
    await sync();
  });

program
  .command("log-level")
  .description("Get or set the log level (debug, verbose, info, error)")
  .argument("[level]", "Log level to set")
  .action((level?: string) => {
    const valid = ["debug", "verbose", "info", "error"];
    if (!level) {
      const config = loadConfig();
      console.log(`Current log level: ${config?.logLevel ?? "info"}`);
      console.log(`\nSet with: sprintspends log-level <${valid.join("|")}>`);
      console.log(`Or env var: SPRINTSPENDS_LOG_LEVEL=debug`);
      console.log(`\nLog file: ~/.sprintspends/sprintspends.log`);
      return;
    }
    if (!valid.includes(level)) {
      console.error(`Invalid level "${level}". Must be one of: ${valid.join(", ")}`);
      process.exit(1);
    }
    updateConfig({ logLevel: level } as Partial<Config>);
    console.log(`Log level set to: ${level}`);
  });

program.parse();
