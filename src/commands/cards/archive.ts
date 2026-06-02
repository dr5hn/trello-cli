/**
 * `trello-cli cards archive` — archive (close) a single card or every open
 * card in a list.
 *
 * Trello "archive" = `PUT /cards/{id}` with `closed=true`. Archived cards leave
 * the board view but remain recoverable from the board's archive, so the action
 * is reversible — though un-archiving in bulk is tedious, hence `--dry-run`.
 *
 * Exactly one target is required:
 *   - by card:  archive <cardId>
 *   - by list:  archive --list "Done"   (archives all open cards in that list)
 */

import pc from "picocolors";
import { type CommandContext, loadContext } from "../../lib/context.js";
import { loadListMap, resolveListId } from "../../lib/resolve.js";
import { format, type OutputMode } from "../../lib/output.js";

export interface ArchiveOptions {
  cardId?: string;
  list?: string;
  dryRun?: boolean;
}

export interface ArchivedCard {
  id: string;
  name: string;
}

export interface ArchiveResult {
  source: "card" | "list";
  dryRun: boolean;
  archived: ArchivedCard[];
}

/**
 * Archive one card or every open card in a list.
 *
 * @param ctx  Loaded auth + Trello client.
 * @param opts Target selector (`cardId` XOR `list`) plus optional `dryRun`.
 * @returns The cards that were (or, in dry-run, would be) archived.
 * @throws Error when neither or both targets are supplied.
 * @throws ResolutionError when `list` names a list absent from the board.
 */
export async function archive(
  ctx: CommandContext,
  opts: ArchiveOptions,
): Promise<ArchiveResult> {
  const hasCard = opts.cardId !== undefined && opts.cardId.length > 0;
  const hasList = opts.list !== undefined && opts.list.length > 0;
  if (hasCard && hasList) {
    throw new Error("Provide either a card ID or --list, not both.");
  }
  if (!hasCard && !hasList) {
    throw new Error("Provide a card ID or --list to archive.");
  }

  const dryRun = opts.dryRun ?? false;

  if (hasCard) {
    const cardId = opts.cardId as string;
    const card = dryRun
      ? await ctx.client.getCard(cardId, { fields: "name" })
      : await ctx.client.updateCard(cardId, { closed: true });
    return {
      source: "card",
      dryRun,
      archived: [{ id: card.id, name: card.name }],
    };
  }

  const listMap = await loadListMap(ctx.client, ctx.auth.boardId);
  const listId = resolveListId(opts.list as string, listMap);
  const cards = await ctx.client.cardsInList(listId, { fields: "name" });

  const archived: ArchivedCard[] = [];
  for (const card of cards) {
    if (!dryRun) {
      await ctx.client.updateCard(card.id, { closed: true });
    }
    archived.push({ id: card.id, name: card.name });
  }
  return { source: "list", dryRun, archived };
}

// CLI handler

export interface ArchiveCommandOptions extends ArchiveOptions {
  format?: OutputMode;
}

export async function archiveCommand(opts: ArchiveCommandOptions): Promise<void> {
  const ctx = await loadContext();
  const result = await archive(ctx, {
    ...(opts.cardId !== undefined ? { cardId: opts.cardId } : {}),
    ...(opts.list !== undefined ? { list: opts.list } : {}),
    dryRun: opts.dryRun ?? false,
  });

  const mode = opts.format ?? "json";
  if (mode === "table") {
    const verb = result.dryRun ? "would archive" : "archived";
    const where = result.source === "list" ? ` from "${opts.list}"` : "";
    process.stdout.write(
      `${pc.green("✓")} ${verb} ${result.archived.length} card(s)${where}\n`,
    );
    for (const card of result.archived) {
      process.stdout.write(`  ${pc.dim(card.id)}  ${card.name}\n`);
    }
  } else {
    process.stdout.write(`${format(result, "json")}\n`);
  }
}
