# @dr5hn/trello-cli

Generic Trello command-line interface in TypeScript. Built for the [Webby Wonder Autopilot](../docs/superpowers/specs/2026-04-18-ww-auto-design.md) but consumable from cron, shell scripts, the intern, or humans.

## Features

- All HTTP requests rate-limited (token bucket: 25 req/s steady, 100 burst), with exponential backoff on `429` and respect for `Retry-After`
- Output is JSON by default for piping into `jq`; pass `--format table` for a humans view
- Auth lives at `~/.config/trello-cli/auth.json` (chmod 600, atomic writes) with optional `XDG_CONFIG_HOME` and `TRELLO_CLI_AUTH_PATH` overrides
- Best-effort `cards claim` protocol with claim re-check rollback for the WW-Auto worker use case
- Idempotent `init`, `labels ensure`, and board scaffolding — safe to re-run
- ESM (Node 22+), zero `any` in the public API, validated with [Zod](https://zod.dev)

## Install

```bash
npm install -g @dr5hn/trello-cli
```

## Quickstart

```bash
trello-cli init                    # interactive: API key, token, board, scaffolding
trello-cli cards list --label ww-ready --not-label intern-ok
trello-cli board summary
```

## Commands

### Setup

| Command | Purpose |
|---|---|
| `trello-cli init [--board-id <id>] [--force]` | One-time setup: API key, token, board ID, status card. Refuses to overwrite existing auth without `--force`. |
| `trello-cli labels ensure` | Idempotently create the 8 ww-* workflow labels on the configured board. |

### Cards

| Command | Purpose |
|---|---|
| `trello-cli cards list` | Filtered card listing. See "Filters" below. |
| `trello-cli cards get <id>` | Full card detail including custom fields. |
| `trello-cli cards create --title "..." [--list X] [--label Y...] [--field K=V...]` | Create a card. Defaults to first open list. |
| `trello-cli cards update <id> [--add-label X] [--remove-label Y] [--list Z] [--field K=V]` | Mutate labels, list, or custom fields. |
| `trello-cli cards comment <id> --body "..."` (or `--from-stdin`) | Add a comment. |
| `trello-cli cards claim <id> [--worker-id <id>]` | Best-effort 4-step claim protocol (worker use). Worker-id defaults to `<hostname>:<pid>:<iso>`. |
| `trello-cli cards release <id> --status <pr-opened\|stuck\|done> [--pr-url X] [--reason Y]` | Atomic state transition + clear `claimed-at` field + post status comment. |

### Board

| Command | Purpose |
|---|---|
| `trello-cli board summary` | Counts by list × label, excluding lists in `internal_lists` config. Used by Daily Pulse. |

### Watch (NDJSON streaming)

| Command | Purpose |
|---|---|
| `trello-cli watch [--label X] [--interval 15m]` | Long-poll for new cards matching a filter; emit one NDJSON event per appearance. |

### Filters for `cards list`

```
--label <name>...      include cards with ALL listed labels (repeatable)
--not-label <name>...  exclude cards bearing ANY of these labels (repeatable)
--list <name>          restrict to one list
--repo <name>...       filter by `repo` custom field exact match (repeatable)
--mine                 restrict to cards assigned to the authed user
--stale-days <n>       only cards untouched for N+ days
--tier <tier>          (reserved — not yet implemented in Phase 1; use --repo)
```

### Output

```
-f, --format <mode>    json (default) or table
-v, --verbose          verbose logging to stderr
```

## Examples

```bash
# Cards ready for the worker, excluding intern-claimed cards
trello-cli cards list --label ww-ready --not-label intern-ok

# Mark a card as having an open PR
trello-cli cards release ABC123 --status pr-opened --pr-url https://github.com/x/y/pull/42

# Capture an idea from a script
echo "Add batch country export to csc-cli" \
  | trello-cli cards create --title - --list "Ideas" --label tier-green

# Watch for new ww-ready cards every 5 minutes
trello-cli watch --label ww-ready --interval 5m | jq '.card.name'

# Compose a board snapshot for Slack
trello-cli board summary | jq '{cards: .totalCards, ready: (.labels[] | select(.name=="ww-ready") | .cardCount)}'
```

## Auth setup

`trello-cli init` walks you through this interactively:

1. Get an **API key** from [https://trello.com/app-key](https://trello.com/app-key)
2. Authorize the CLI to get a **token** (URL printed during init)
3. Pick the **board** to use (interactive menu, or pass `--board-id`)

Resulting `~/.config/trello-cli/auth.json` (chmod 600):

```json
{
  "apiKey": "...",
  "token": "...",
  "boardId": "...",
  "internal_lists": ["📊 Internal"]
}
```

To override the path: `export TRELLO_CLI_AUTH_PATH=/some/where/auth.json` or `export XDG_CONFIG_HOME=/elsewhere`.

## Development

```bash
npm install
npm run dev -- cards list --label ww-ready    # run from source via tsx
npm test                                       # vitest, 100%+ coverage on lib/
npm run lint                                   # tsc --noEmit
npm run build                                  # emit dist/
```

Tests use `undici`'s `MockAgent` (not `nock`, which doesn't intercept undici's directly-imported fetch in v14).

## Phase 1 limitations

The following are designed but deferred:

- `--tier` filter on `cards list` — declared on the CLI for spec conformance but throws a clear error directing to `--repo`. Implementing requires reading `~/.claude/webby-wonder/tier-config.json`, which would couple this CLI to WW-Auto. Worker-side resolution is the cleaner path for now.
- Cross-process rate-limiter coordination via `proper-lockfile` — included as a dependency, not yet wired. Single-process buckets are sufficient for the Phase 1 single-worker invariant.

## License

MIT
