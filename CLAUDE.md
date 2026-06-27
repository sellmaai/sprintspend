# SprintSpends

AI cost tracking for Linear via Claude Code hooks.

## Slash Commands

### /configure_linear

Run `sprintspends configure` to set up SprintSpends. This will:
1. Authorize with Linear via OAuth (opens browser)
2. Ask for the team's shared Anthropic API key
3. Install the Claude Code Stop hook
4. Create the "AI Spend ($)" custom field in Linear

## Development

```bash
npm install          # Install dependencies
npm run dev -- <cmd> # Run CLI in dev mode (e.g. npm run dev -- status)
npm run build        # Build for distribution
npm test             # Run tests
```

## How It Works

1. A Claude Code `Stop` hook fires after each assistant turn
2. `sprintspends track` parses the session transcript for token usage
3. After 3 turns, it classifies the conversation to a Linear issue using Claude Haiku
4. Cost is calculated and stored in a local ledger (`~/.sprintspends/ledger.json`)
5. The Linear issue's "AI Spend ($)" custom field is updated additively
