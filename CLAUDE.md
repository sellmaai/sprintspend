# SprintSpends

AI cost tracking for Linear via Claude Code hooks.

## Slash Commands

### /configure_linear

Set up SprintSpends for this developer. Run `sprintspends configure` in the terminal. This will:
1. Read the Linear OAuth client ID from `.sprintspends.json` in the repo
2. Open the browser to authorize with Linear (OAuth)
3. Install the Claude Code Stop hook in `~/.claude/settings.json`

If `sprintspends` is not installed, install it first:
```bash
git clone https://github.com/sellmaai/sprintspend.git ~/.sprintspends/app
cd ~/.sprintspends/app && npm install && npm run build && npm link
```

Then run `sprintspends configure` from this repo directory.

### /sprintspends_status

Run `sprintspends status` to show the local cost summary by project.

## Development

```bash
npm install          # Install dependencies
npm run dev -- <cmd> # Run CLI in dev mode (e.g. npm run dev -- status)
npm run build        # Build for distribution
npm test             # Run tests
```

## How It Works

1. A Claude Code `Stop` hook fires after each assistant turn (async, non-blocking)
2. `sprintspends track` parses the session transcript for token usage and calculates cost
3. After 2 turns, it classifies the conversation to a Linear project using `claude -p --model haiku`
4. Cost is stored in a local ledger (`~/.sprintspends/ledger.json`)
5. A project update is posted to Linear with per-developer cost breakdown
