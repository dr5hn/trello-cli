/**
 * `trello-cli cards update <id>` — mutate labels, list, or custom fields.
 */

import { loadContext } from "../../lib/context.js";
import {
  loadLabelMap,
  loadListMap,
  loadCustomFieldMap,
  resolveLabelIds,
  resolveListId,
  resolveCustomField,
} from "../../lib/resolve.js";
import { format, type OutputMode } from "../../lib/output.js";
import { parseFieldKvs } from "./create.js";

export interface UpdateOptions {
  cardId: string;
  addLabel?: string[];
  removeLabel?: string[];
  list?: string;
  field?: string[];
  format?: OutputMode;
}

export interface UpdateResult {
  cardId: string;
  labelsAdded: string[];
  labelsRemoved: string[];
  movedTo: string | null;
  fieldsSet: Record<string, string>;
}

export async function updateCommand(opts: UpdateOptions): Promise<void> {
  const ctx = await loadContext();
  const result: UpdateResult = {
    cardId: opts.cardId,
    labelsAdded: [],
    labelsRemoved: [],
    movedTo: null,
    fieldsSet: {},
  };

  if (
    (opts.addLabel?.length ?? 0) > 0 ||
    (opts.removeLabel?.length ?? 0) > 0
  ) {
    const labelMap = await loadLabelMap(ctx.client, ctx.auth.boardId);
    if (opts.addLabel) {
      const ids = resolveLabelIds(opts.addLabel, labelMap);
      for (let i = 0; i < ids.length; i++) {
        await ctx.client.addLabelToCard(opts.cardId, ids[i]!);
        result.labelsAdded.push(opts.addLabel[i]!);
      }
    }
    if (opts.removeLabel) {
      const ids = resolveLabelIds(opts.removeLabel, labelMap);
      for (let i = 0; i < ids.length; i++) {
        await ctx.client.removeLabelFromCard(opts.cardId, ids[i]!);
        result.labelsRemoved.push(opts.removeLabel[i]!);
      }
    }
  }

  if (opts.list) {
    const listMap = await loadListMap(ctx.client, ctx.auth.boardId);
    const listId = resolveListId(opts.list, listMap);
    await ctx.client.updateCard(opts.cardId, { idList: listId });
    result.movedTo = opts.list;
  }

  if (opts.field && opts.field.length > 0) {
    const fieldMap = await loadCustomFieldMap(ctx.client, ctx.auth.boardId);
    const kvs = parseFieldKvs(opts.field);
    for (const [name, value] of kvs) {
      const field = resolveCustomField(name, fieldMap);
      await ctx.client.setCustomFieldText(opts.cardId, field.id, value);
      result.fieldsSet[name] = value;
    }
  }

  process.stdout.write(`${format(result, opts.format ?? "json")}\n`);
}
