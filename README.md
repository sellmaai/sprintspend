# SprintSpends

Automatic AI cost tracking for [Linear](https://linear.app) via [Claude Code](https://docs.anthropic.com/en/docs/claude-code) hooks.

Each developer runs SprintSpends locally. It silently tracks Claude Code session costs, classifies conversations to Linear projects using an LLM, and posts a per-developer cost breakdown as a project update in Linear.

## How It Works

```
Claude Code (Stop hook, async — dev notices nothing)
  └─ sprintspends track
      ├─ Parse session transcript for token usage (local)
      ├─ Calculate cost using Anthropic pricing (local)
      ├─ After 2 turns: classify to Linear project via claude -p (uses existing auth)
      ├─ Store in local ledger (~/.sprintspends/ledger.json)
      └─ Post project update to Linear with per-dev cost breakdown
```

No backend server. No separate API keys. Everything runs on the dev's machine. The only outbound calls are to the Linear API and `claude -p` for classification.

## Setup

### 1. Org Manager (one-time)

Register an OAuth app in Linear:

1. Go to **Linear Settings > API > OAuth Applications > New**
2. Name: `SprintSpends`
3. Redirect URI: `http://localhost:3456/callback`
4. Click **Create** and copy the **Client ID**

Commit the client ID to your repo:

```bash
echo '{"linearClientId":"YOUR_CLIENT_ID"}' > .sprintspends.json
git add .sprintspends.json && git commit -m "Add SprintSpends config"
```

### 2. Each Developer

One command to install (or update) and configure:

```bash
curl -fsSL https://raw.githubusercontent.com/sellmaai/sprintspend/main/install.sh | bash
```

Or from Claude Code, type `/configure_linear`.

This will:
1. Clone/update the SprintSpends CLI
2. Open your browser to authorize with Linear (OAuth)
3. Install the Claude Code Stop hook in `~/.claude/settings.json`

That's it. Start using Claude Code normally. Safe to re-run — it cleans up old hooks and migrates data.

## What Happens During a Session

| Turn | Cost Tracking | Classification |
|------|--------------|----------------|
| 1 | Parses transcript, calculates cost, saves to ledger | Skipped (too early) |
| 2 | Calculates cost, saves to ledger | Classifies conversation to a Linear project |
| 3+ | Calculates cost, syncs delta to Linear | Already done, uses cached result |

- Cost is calculated from the **full transcript** each turn (not incremental), so no cost is lost
- Classification runs once per session using `claude -p --model haiku` (~$0.08, uses your existing Claude Code auth)
- If no project matches, the session stays "unclassified" locally

## What Shows in Linear

The project update (visible in the "Updates" column of the projects list) shows a per-developer breakdown:

```
AI Spend: $45.50

| Developer | Cost   |
|-----------|--------|
| Alice     | $28.00 |
| Bob       | $17.50 |
| Total     | $45.50 |

Tracked by SprintSpends
```

Each dev's sync reads the existing update, preserves other devs' rows, and updates their own.

## CLI Commands

| Command | Description |
|---------|-------------|
| `sprintspends configure` | Set up OAuth, install hook (safe to re-run) |
| `sprintspends status` | Show local cost summary by project |
| `sprintspends sync` | Force sync all unsynced costs to Linear |
| `sprintspends track` | Called by the hook — not meant to be run manually |

## Claude Code Slash Commands

Available in any repo with `.sprintspends.json`, or globally after first configure:

| Command | Description |
|---------|-------------|
| `/configure_linear` | Install/update + OAuth + hook setup |
| `/sprintspends_status` | Show local cost summary |
| `/sprintspends_sync` | Force sync costs to Linear |

## Local Files

| Path | Purpose |
|------|---------|
| `~/.sprintspends/config.json` | Linear OAuth token, user ID |
| `~/.sprintspends/ledger.json` | Local cost ledger (all sessions) |
| `~/.sprintspends/classifications/` | Cached project classifications per session |
| `~/.sprintspends/error.log` | Error log for debugging |
| `.sprintspends.json` (in repo) | Linear OAuth client ID (committed, shared) |

## Cost Calculation

Costs are calculated from token usage in the Claude Code transcript using current Anthropic pricing:

| Model | Input | Output | Cache Write (5m) | Cache Write (1h) | Cache Read |
|-------|-------|--------|------------------|------------------|------------|
| Opus 4.6 | $5/MTok | $25/MTok | $6.25/MTok | $10/MTok | $0.50/MTok |
| Sonnet 4.6 | $3/MTok | $15/MTok | $3.75/MTok | $6/MTok | $0.30/MTok |
| Haiku 4.5 | $1/MTok | $5/MTok | $1.25/MTok | $2/MTok | $0.10/MTok |

Unknown models fall back to Opus pricing (conservative estimate).

## Development

```bash
npm install          # Install dependencies
npm run dev -- <cmd> # Run CLI in dev mode
npm run build        # Build for distribution
npm test             # Run tests (32 tests)
```

## License

MIT
