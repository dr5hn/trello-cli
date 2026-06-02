/**
 * `trello-cli cards update <id>` — mutate a card's name, description, list,
 * labels, members, or custom fields.
 *
 * Labels accept either an exact label name or a bare colour token (the latter
 * resolves the board's unnamed "category" label of that colour — see
 * resolveLabelRefs). Members accept an id, username, or full name.
 */

import pc from "picocolors";
import { type CommandContext, loadContext } from "../../lib/context.js";
import {
  loadListMap,
  loadCustomFieldMap,
  resolveListId,
  resolveCustomField,
  resolveLabelRefs,
  resolveMemberIds,
} from "../../lib/resolve.js";
import { format, type OutputMode } from "../../lib/output.js";
import { parseFieldKvs } from "./create.js";

export interface UpdateOptions {
  cardId: string;
  name?: string;
  description?: string;
  addLabel?: string[];
  removeLabel?: string[];
  assign?: string[];
  unassign?: string[];
  list?: string;
  field?: string[];
}

export interface UpdateResult {
  cardId: string;
  renamed: string | null;
  descriptionSet: boolean;
  labelsAdded: string[];
  labelsRemoved: string[];
  membersAdded: string[];
  membersRemoved: string[];
  movedTo: string | null;
  fieldsSet: Record<string, string>;
}

/**
 * Apply the requested mutations to a card. Each concern is independent and
 * only triggers the API calls it needs, so callers pay only for what they ask.
 *
 * @returns A structured record of exactly what changed (useful for reporting
 *   back to a human or a calling script).
 */
export async function update(
  ctx: CommandContext,
  opts: UpdateOptions,
): Promise<UpdateResult> {
  const result: UpdateResult = {
    cardId: opts.cardId,
    renamed: null,
    descriptionSet: false,
    labelsAdded: [],
    labelsRemoved: [],
    membersAdded: [],
    membersRemoved: [],
    movedTo: null,
    fieldsSet: {},
  };

  // Name + description go together in one card PUT.
  if (opts.name !== undefined || opts.description !== undefined) {
    await ctx.client.updateCard(opts.cardId, {
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.description !== undefined ? { desc: opts.description } : {}),
    });
    if (opts.name !== undefined) result.renamed = opts.name;
    if (opts.description !== undefined) result.descriptionSet = true;
  }

  // Labels — resolve by name or colour against the full board label set.
  if ((opts.addLabel?.length ?? 0) > 0 || (opts.removeLabel?.length ?? 0) > 0) {
    const allLabels = await ctx.client.labelsOnBoard(ctx.auth.boardId);
    if (opts.addLabel?.length) {
      const ids = resolveLabelRefs(opts.addLabel, allLabels);
      for (let i = 0; i < ids.length; i++) {
        await ctx.client.addLabelToCard(opts.cardId, ids[i]!);
        result.labelsAdded.push(opts.addLabel[i]!);
      }
    }
    if (opts.removeLabel?.length) {
      const ids = resolveLabelRefs(opts.removeLabel, allLabels);
      for (let i = 0; i < ids.length; i++) {
        await ctx.client.removeLabelFromCard(opts.cardId, ids[i]!);
        result.labelsRemoved.push(opts.removeLabel[i]!);
      }
    }
  }

  // Members — resolve by id / username / full name.
  if ((opts.assign?.length ?? 0) > 0 || (opts.unassign?.length ?? 0) > 0) {
    const members = await ctx.client.membersOnBoard(ctx.auth.boardId);
    if (opts.assign?.length) {
      const ids = resolveMemberIds(opts.assign, members);
      for (let i = 0; i < ids.length; i++) {
        await ctx.client.addMemberToCard(opts.cardId, ids[i]!);
        result.membersAdded.push(opts.assign[i]!);
      }
    }
    if (opts.unassign?.length) {
      const ids = resolveMemberIds(opts.unassign, members);
      for (let i = 0; i < ids.length; i++) {
        await ctx.client.removeMemberFromCard(opts.cardId, ids[i]!);
        result.membersRemoved.push(opts.unassign[i]!);
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

  return result;
}

// CLI handler

export interface UpdateCommandOptions extends UpdateOptions {
  format?: OutputMode;
}

export async function updateCommand(opts: UpdateCommandOptions): Promise<void> {
  const ctx = await loadContext();
  const result = await update(ctx, opts);

  const mode = opts.format ?? "json";
  if (mode === "table") {
    const parts: string[] = [];
    if (result.renamed) parts.push(`renamed → "${result.renamed}"`);
    if (result.descriptionSet) parts.push("description set");
    if (result.movedTo) parts.push(`moved → ${result.movedTo}`);
    if (result.labelsAdded.length) parts.push(`+labels ${result.labelsAdded.join(", ")}`);
    if (result.labelsRemoved.length) parts.push(`-labels ${result.labelsRemoved.join(", ")}`);
    if (result.membersAdded.length) parts.push(`+members ${result.membersAdded.join(", ")}`);
    if (result.membersRemoved.length) parts.push(`-members ${result.membersRemoved.join(", ")}`);
    const fieldKeys = Object.keys(result.fieldsSet);
    if (fieldKeys.length) parts.push(`fields ${fieldKeys.join(", ")}`);
    process.stdout.write(
      `${pc.green("✓ updated")} ${result.cardId}${parts.length ? ` (${parts.join("; ")})` : " (no changes)"}\n`,
    );
  } else {
    process.stdout.write(`${format(result, "json")}\n`);
  }
}
