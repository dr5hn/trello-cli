# Changelog

All notable changes to `@dr5hn/trello-cli` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-18

Initial public release.

### Added

- **`trello-cli init`** — interactive one-time setup. Prompts for API key, token, and target board; validates credentials before persisting; creates the `📊 Internal` list and `📊 WW Worker Status` card; runs `labels ensure` automatically. Refuses to overwrite existing auth without `--force`.
- **`trello-cli labels ensure`** — idempotently creates the 8 opinionated workflow labels (`ww-ready`, `ww-working`, `ww-pr-opened`, `ww-stuck`, `ww-yellow-ok`, `ww-stop-this-card`, `intern-ok`, `stale`).
- **`trello-cli cards list`** — filtered card listing. Filters: `--label`, `--not-label` (both repeatable, AND/NOT semantics), `--list`, `--repo` (custom-field match, repeatable), `--mine`, `--stale-days`. `--tier` is reserved on the CLI but throws a clear error directing to `--repo` (would couple this generic CLI to a downstream consumer's tier config).
- **`trello-cli cards get <id>`** — full card detail with custom field items.
- **`trello-cli cards create`** — create a card. Supports `--title`, `--list`, `--label` (repeatable), `--field K=V` (repeatable), `--description`. Defaults to first open list when `--list` is omitted.
- **`trello-cli cards update <id>`** — mutate labels / list / custom fields. Partial updates honoured.
- **`trello-cli cards comment <id>`** — add a comment via `--body "..."` or `--from-stdin`.
- **`trello-cli cards claim <id>`** — best-effort 4-step claim protocol with re-check rollback. Worker-id defaults to `<hostname>:<pid>:<iso8601>`.
- **`trello-cli cards release <id>`** — atomic state transition: swaps the appropriate label, **clears the `claimed-at` custom field** (essential — manually-rescued cards must be re-claimable), posts a status comment. Status options: `pr-opened` (requires `--pr-url`), `stuck` (requires `--reason`), `done`.
- **`trello-cli board summary`** — counts by list × label, excludes lists in the `internal_lists` config (defaults to `["📊 Internal"]`). Stable JSON shape suitable for periodic-summary consumers.
- **`trello-cli watch`** — long-poll for new cards matching a filter; emits one NDJSON event per appearance. Configurable `--interval` (default `15m`).

### Engineering

- All HTTP requests pass through a shared token-bucket rate limiter (25 req/s steady, 100 burst) with exponential backoff (1s → 2s → 4s → 8s → 30s capped) on `429` and respect for the `Retry-After` header.
- Auth persists at `$XDG_CONFIG_HOME/trello-cli/auth.json` (chmod 600, atomic tmp-file + rename writes), validated with [Zod](https://zod.dev). Override via `TRELLO_CLI_AUTH_PATH`.
- Output is JSON by default for `jq` piping; `--format table` for humans.
- 116 unit tests across 15 files using `undici`'s native `MockAgent` (the canonical undici interception path; `nock@14` does not reliably intercept `undici`'s directly-imported fetch).
- TypeScript strict mode with `noUncheckedIndexedAccess` enabled. ESM, Node 22+.
- CI: GitHub Actions matrix on Node 22 + 24, lint + test + build + binary smoke check.
- Release: GitHub release publish triggers npm publish with provenance signing (id-token: write).

[Unreleased]: https://github.com/dr5hn/trello-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dr5hn/trello-cli/releases/tag/v0.1.0
