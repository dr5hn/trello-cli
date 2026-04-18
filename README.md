# @dr5hn/trello-cli

[![npm](https://img.shields.io/npm/v/@dr5hn/trello-cli?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@dr5hn/trello-cli)
[![CI](https://img.shields.io/github/actions/workflow/status/dr5hn/trello-cli/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/dr5hn/trello-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/node/v/@dr5hn/trello-cli?style=flat-square)](https://nodejs.org)

Generic Trello command-line interface in TypeScript — designed for autonomous-worker integrations, cron jobs, shell scripts, and humans alike.

## Features

- All HTTP requests rate-limited (token bucket: 25 req/s steady, 100 burst), with exponential backoff on `429` and respect for `Retry-After`
- Output is JSON by default for piping into `jq`; pass `--format table` for a humans view
- Auth lives at `~/.config/trello-cli/auth.json` (chmod 600, atomic writes) with optional `XDG_CONFIG_HOME` and `TRELLO_CLI_AUTH_PATH` overrides
- Best-effort `cards claim` protocol with claim re-check rollback for autonomous-worker use cases
- Idempotent `init`, `labels ensure`, and board scaffolding — safe to re-run
- ESM (Node 22+), zero `any` in the public API, validated with [Zod](https://zod.dev)

## Install

```bash
npm install -g @dr5hn/trello-cli
```

## Quickstart

First-time setup needs a Trello **API key**, **user token**, and **board ID** — see [Auth setup](#auth-setup) for how to obtain them.

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
| `trello-cli board summary` | Counts by list × label, excluding lists in `internal_lists` config. Useful for periodic summary jobs. |

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

You need three values: an **API key**, a **user token**, and a **board ID**. Trello's current flow requires creating a Power-Up first — the legacy `trello.com/app-key` page was retired by Atlassian.

### 1. Get an API key

1. Sign in to Trello, then visit **[https://trello.com/power-ups/admin](https://trello.com/power-ups/admin)**.
2. Click **"New"** and create a Power-Up. The fields don't have to be meaningful for CLI use:
   - **Name**: `trello-cli` (or anything)
   - **Workspace**: pick any workspace you belong to
   - **Iframe connector URL**: leave blank or use `https://example.com`
   - **Author / email / support contact**: your own
3. After creation, open the Power-Up and go to the **API Key** tab.
4. Click **"Generate a new API Key"** and accept the prompt. Copy the key.

### 2. Generate a user token

On the same API Key page, click the hyperlinked **"Token"** next to your API key. This opens the OAuth-style authorization screen — approve it and Trello returns a token.

Or build the URL yourself (useful for scripts):

```
https://trello.com/1/authorize?expiration=never&name=trello-cli&scope=read,write&response_type=token&key=YOUR_API_KEY
```

Replace `YOUR_API_KEY`, open the URL, approve, and copy the token from the resulting page.

> **Heads up:** the token is a user credential with the scope you just granted (`read,write` above). Treat it like a password. `expiration=never` is convenient for a worker; swap to `1day` / `30days` if you'd rather rotate.

### 3. Find your board ID

Open the board in Trello. The URL looks like:

```
https://trello.com/b/ABCD1234/my-board
         ^^^^^^^^^^^^^^^^^^^^^^^
         this 8-char segment is the board ID
```

Alternatively, append `.json` to any board URL to see the full ID and metadata.

### 4. Wire it in

Interactive (recommended for first-time setup):

```bash
trello-cli init                   # prompts for key, token, board, plus scaffolding
# or, if you only want auth without scaffolding:
trello-cli auth
```

Scripted (CI, provisioning, Dockerfiles):

```bash
trello-cli auth \
  --api-key "$TRELLO_API_KEY" \
  --token "$TRELLO_TOKEN" \
  --board-id "$TRELLO_BOARD_ID"
```

Either path writes `~/.config/trello-cli/auth.json` (chmod 600, atomic):

```json
{
  "apiKey": "...",
  "token": "...",
  "boardId": "...",
  "internal_lists": ["📊 Internal"]
}
```

To override the path: `export TRELLO_CLI_AUTH_PATH=/some/where/auth.json` or `export XDG_CONFIG_HOME=/elsewhere`.

### Verify

```bash
trello-cli board summary          # smoke-tests auth + board access
```

If you see a `401` / `403`, the token is wrong or was revoked. A `404` on the board ID usually means the token's user can't access that board.

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

- `--tier` filter on `cards list` — reserved on the CLI but throws a clear error directing to `--repo`. Implementing tier resolution would require this generic CLI to read a downstream consumer's configuration, coupling it to a specific use case. Use `--repo` and let the consumer resolve tier→repo set on its own side.
- Cross-process rate-limiter coordination via `proper-lockfile` — included as a dependency, not yet wired. Single-process buckets are sufficient for typical single-worker setups.

## License

MIT
