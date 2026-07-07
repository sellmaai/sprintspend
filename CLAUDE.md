# SprintSpends

AI cost tracking for Linear via Claude Code and Codex hooks.

## Slash Commands

### /configure_linear

Install/update and configure SprintSpends in one step:
```bash
curl -fsSL https://raw.githubusercontent.com/sellmaai/sprintspend/main/install.sh | bash
```

### /sprintspends_status

Run `sprintspends status` to show the local cost summary by project.

### /sprintspends_sync

Run `sprintspends sync` to force sync all unsynced costs to Linear.

## Development

```bash
npm install          # Install dependencies
npm run dev -- <cmd> # Run CLI in dev mode (e.g. npm run dev -- status)
npm run build        # Build for distribution
npm test             # Run tests
```

## How It Works

1. A Claude Code `Stop` hook or Codex `PostToolUse` hook fires after activity (async, non-blocking)
2. `sprintspends track` auto-detects the transcript format and parses token usage
3. After 2 turns, it classifies the conversation to a Linear project using whichever CLI is available (`claude` or `codex`)
4. Cost is stored in a local ledger (`~/.sprintspends/ledger.json`) with provider tracking
5. A project update is posted to Linear with per-developer cost breakdown (combined across all tools)
