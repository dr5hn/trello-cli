/**
 * `trello-cli cards create` — create a new card.
 *
 * --field K=V (repeatable) sets text custom fields after creation.
 * Custom field K must already exist on the board.
 */

import { loadContext } from "../../lib/context.js";
import { loadLabelMap, loadListMap, loadCustomFieldMap, resolveLabelIds, resolveListId, resolveCustomField } from "../../lib/resolve.js";
import { format, type OutputMode } from "../../lib/output.js";

export interface CreateOptions {
  title: string;
  list?: string;
  label?: string[];
  field?: string[];
  description?: string;
  format?: OutputMode;
}

export async function createCommand(opts: CreateOptions): Promise<void> {
  const ctx = await loadContext();

  const labelMap = await loadLabelMap(ctx.client, ctx.auth.boardId);
  const labelIds = opts.label ? resolveLabelIds(opts.label, labelMap) : [];

  let listId: string;
  if (opts.list) {
    const listMap = await loadListMap(ctx.client, ctx.auth.boardId);
    listId = resolveListId(opts.list, listMap);
  } else {
    // Default to first open list (typically "Todo" or similar)
    const lists = await ctx.client.listsOnBoard(ctx.auth.boardId, "open");
    if (lists.length === 0) {
      throw new Error(`Board ${ctx.auth.boardId} has no open lists.`);
    }
    listId = lists[0]!.id;
  }

  const fieldKvs = parseFieldKvs(opts.field ?? []);

  const card = await ctx.client.createCard({
    idList: listId,
    name: opts.title,
    ...(opts.description !== undefined ? { desc: opts.description } : {}),
    ...(labelIds.length > 0 ? { idLabels: labelIds } : {}),
  });

  // Apply custom fields after creation
  if (fieldKvs.size > 0) {
    const fieldMap = await loadCustomFieldMap(ctx.client, ctx.auth.boardId);
    for (const [name, value] of fieldKvs) {
      const field = resolveCustomField(name, fieldMap);
      await ctx.client.setCustomFieldText(card.id, field.id, value);
    }
  }

  process.stdout.write(`${format(card, opts.format ?? "json")}\n`);
}

export function parseFieldKvs(raw: ReadonlyArray<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of raw) {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid --field entry "${entry}". Expected key=value.`);
    }
    out.set(entry.slice(0, eq).trim(), entry.slice(eq + 1));
  }
  return out;
}
