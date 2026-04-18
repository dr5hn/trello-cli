/**
 * `trello-cli board summary` — counts by list × label, excluding internal lists.
 *
 * Designed for downstream consumers that compose periodic summaries (e.g. a
 * morning-brief cron, a Slack digest bot, a status dashboard). Output shape is
 * intentionally stable so consumers can depend on it.
 */

import { loadContext } from "../lib/context.js";
import { format, type OutputMode } from "../lib/output.js";
import { type TrelloLabel, type TrelloList } from "../trello-client.js";

export interface SummaryOptions {
  format?: OutputMode;
}

export interface BoardSummary {
  board: { id: string; name: string };
  totalCards: number;
  lists: Array<{ id: string; name: string; cardCount: number }>;
  labels: Array<{ id: string; name: string; color: string | null; cardCount: number }>;
  internalListsExcluded: string[];
  generatedAt: string;
}

export async function summarise(): Promise<BoardSummary> {
  const ctx = await loadContext();

  const [board, lists, labels, cards] = await Promise.all([
    ctx.client.getBoard(ctx.auth.boardId, { fields: "id,name" }),
    ctx.client.listsOnBoard(ctx.auth.boardId, "open"),
    ctx.client.labelsOnBoard(ctx.auth.boardId),
    ctx.client.cardsOnBoard(ctx.auth.boardId),
  ]);

  const excludedLists = new Set(ctx.auth.internal_lists ?? []);
  const visibleLists = lists.filter((l) => !excludedLists.has(l.name));
  const visibleListIds = new Set(visibleLists.map((l) => l.id));

  const visibleCards = cards.filter((c) => visibleListIds.has(c.idList));

  const listCounts = countByList(visibleLists, visibleCards);
  const labelCounts = countByLabel(labels, visibleCards);

  return {
    board: { id: board.id, name: board.name },
    totalCards: visibleCards.length,
    lists: listCounts,
    labels: labelCounts,
    internalListsExcluded: Array.from(excludedLists).sort(),
    generatedAt: new Date().toISOString(),
  };
}

function countByList(
  lists: TrelloList[],
  cards: Array<{ idList: string }>,
): BoardSummary["lists"] {
  const counts = new Map<string, number>();
  for (const c of cards) {
    counts.set(c.idList, (counts.get(c.idList) ?? 0) + 1);
  }
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    cardCount: counts.get(l.id) ?? 0,
  }));
}

function countByLabel(
  labels: TrelloLabel[],
  cards: Array<{ idLabels: string[] }>,
): BoardSummary["labels"] {
  const counts = new Map<string, number>();
  for (const c of cards) {
    for (const id of c.idLabels) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return labels.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    cardCount: counts.get(l.id) ?? 0,
  }));
}

export async function summaryCommand(opts: SummaryOptions): Promise<void> {
  const summary = await summarise();
  process.stdout.write(`${format(summary, opts.format ?? "json")}\n`);
}
