/**
 * Idempotent setup helpers for the WW-Auto board scaffolding:
 *   - The hidden `📊 Internal` list (holds operational metadata cards)
 *   - The pinned `📊 WW Worker Status` card (cross-machine state bridge §5.3)
 *
 * Both functions are safe to run repeatedly — they look up by exact-name match
 * before creating. Used by `trello-cli init` and re-runnable as repair tooling.
 */

import {
  TrelloClient,
  type TrelloCard,
  type TrelloList,
} from "../trello-client.js";

export const INTERNAL_LIST_NAME = "📊 Internal";
export const STATUS_CARD_NAME = "📊 WW Worker Status";

/**
 * Initial state JSON written to the status card description on first creation.
 * Matches the privacy contract from spec §5.7 — no `workerId` (which contains
 * hostname) is exposed via the card.
 */
export const INITIAL_STATUS_PAYLOAD = {
  lastTickAt: null,
  inFlightCount: 0,
  todaysPrs: 0,
  todaysStuck: 0,
  backpressureEvents: 0,
  killSwitchEngaged: false,
} as const;

export interface EnsureResult<T> {
  resource: T;
  created: boolean;
}

export async function ensureInternalList(
  client: TrelloClient,
  boardId: string,
  name: string = INTERNAL_LIST_NAME,
): Promise<EnsureResult<TrelloList>> {
  const lists = await client.listsOnBoard(boardId, "open");
  const existing = lists.find((l) => l.name === name);
  if (existing) {
    return { resource: existing, created: false };
  }
  const created = await client.createList({
    idBoard: boardId,
    name,
    pos: "bottom",
  });
  return { resource: created, created: true };
}

export async function ensureStatusCard(
  client: TrelloClient,
  listId: string,
  name: string = STATUS_CARD_NAME,
): Promise<EnsureResult<TrelloCard>> {
  const cards = await client.cardsInList(listId);
  const existing = cards.find((c) => c.name === name);
  if (existing) {
    return { resource: existing, created: false };
  }
  const created = await client.createCard({
    idList: listId,
    name,
    desc: JSON.stringify(INITIAL_STATUS_PAYLOAD, null, 2),
    pos: "top",
  });
  return { resource: created, created: true };
}
