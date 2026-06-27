import { Command } from "commander";
import { configure } from "./commands/configure.js";
import { track } from "./commands/track.js";
import { status } from "./commands/status.js";
import { sync } from "./commands/sync.js";

const program = new Command();

program
  .name("sprintspends")
  .description("AI cost tracking for Linear via Claude Code hooks")
  .version("0.1.0");

program
  .command("configure")
  .description("Set up Linear OAuth, Anthropic API key, and install Claude Code hook")
  .action(async () => {
    await configure(process.cwd());
  });

program
  .command("track")
  .description("Track costs from a Claude Code session (called by hook)")
  .action(async () => {
    await track();
  });

program
  .command("status")
  .description("Show local cost summary by issue")
  .action(async () => {
    await status();
  });

program
  .command("sync")
  .description("Force sync all unsynced costs to Linear")
  .action(async () => {
    await sync();
  });

program.parse();
