/**
 * `trello-cli watch` — long-poll for new cards matching a filter.
 *
 * Each tick fetches cards matching the label filter; any card not seen
 * before is emitted as one NDJSON line on stdout. Designed to be piped:
 *
 *     trello-cli watch --label ww-ready --interval 15m | jq '.id'
 *
 * SIGINT/SIGTERM exit cleanly with a "watch_stopped" event.
 */

import { loadContext } from "../lib/context.js";
import { loadLabelMap, resolveLabelIds } from "../lib/resolve.js";

export interface WatchOptions {
  label?: string;
  interval?: string; // human duration: "15m", "30s", "1h"
}

export async function watchCommand(opts: WatchOptions): Promise<void> {
  const intervalMs = parseDuration(opts.interval ?? "15m");
  const ctx = await loadContext();

  let labelId: string | null = null;
  if (opts.label) {
    const labelMap = await loadLabelMap(ctx.client, ctx.auth.boardId);
    const ids = resolveLabelIds([opts.label], labelMap);
    labelId = ids[0] ?? null;
  }

  const seen = new Set<string>();
  let stopRequested = false;

  const stop = (signal: string) => {
    stopRequested = true;
    emit({ event: "watch_stopped", signal, at: new Date().toISOString() });
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  emit({
    event: "watch_started",
    label: opts.label ?? null,
    intervalMs,
    at: new Date().toISOString(),
  });

  // Prime the seen-set with current state so we don't flood on first tick
  const initial = await ctx.client.cardsOnBoard(ctx.auth.boardId);
  for (const c of initial) {
    if (!labelId || c.idLabels.includes(labelId)) seen.add(c.id);
  }
  emit({
    event: "watch_primed",
    seenCount: seen.size,
    at: new Date().toISOString(),
  });

  while (!stopRequested) {
    await sleep(intervalMs);
    if (stopRequested) break;

    try {
      const cards = await ctx.client.cardsOnBoard(ctx.auth.boardId);
      for (const c of cards) {
        if (labelId && !c.idLabels.includes(labelId)) continue;
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        emit({
          event: "card_appeared",
          card: { id: c.id, name: c.name, idList: c.idList, idLabels: c.idLabels, url: c.shortUrl },
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      emit({
        event: "watch_error",
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
      // Don't exit; transient API errors shouldn't kill a long-running watch.
    }
  }
}

function emit(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a duration string like "15m", "30s", "2h", "1500ms" into milliseconds.
 * Bare numbers are treated as milliseconds.
 */
export function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!match) {
    throw new Error(
      `Invalid --interval "${input}". Examples: 15m, 30s, 1h, 1500ms`,
    );
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`unreachable: unit ${unit}`);
  }
}
