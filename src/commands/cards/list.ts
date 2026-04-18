/**
 * `trello-cli cards list` — filtered card listing.
 *
 * Filters compose with AND semantics across types and within the same type:
 *   --label X --label Y         → cards that have both X AND Y
 *   --not-label A --not-label B → cards that have neither A NOR B
 *   --list "Todo"               → cards in the Todo list
 *   --repo csc-cli              → cards whose `repo` custom field == "csc-cli"
 *   --mine                      → cards assigned to the authed user
 *   --stale-days N              → cards with dateLastActivity older than N days
 *
 * `--tier` (green/yellow/red) is reserved on the CLI but deliberately
 * unimplemented — wiring it up would require this generic CLI to read a
 * downstream consumer's tier-mapping config, coupling it to a specific use
 * case. Use `--repo` instead, and let the consumer resolve tier→repo set on
 * its own side.
 */

import { type CommandContext, loadContext } from "../../lib/context.js";
import {
  loadLabelMap,
  loadListMap,
  loadCustomFieldMap,
  resolveLabelIds,
  resolveListId,
  resolveCustomField,
} from "../../lib/resolve.js";
import { format, type OutputMode } from "../../lib/output.js";
import {
  type TrelloCard,
  type TrelloCustomFieldItem,
} from "../../trello-client.js";

export interface ListFilters {
  label?: string[];
  notLabel?: string[];
  list?: string;
  repo?: string[];
  mine?: boolean;
  staleDays?: number;
  tier?: string; // accepted but unimplemented (see header comment)
}

export interface ListOptions extends ListFilters {
  format?: OutputMode;
}

export async function listCards(
  ctx: CommandContext,
  filters: ListFilters,
  now: Date = new Date(),
): Promise<TrelloCard[]> {
  if (filters.tier) {
    throw new Error(
      "--tier is declared in the spec but not yet implemented in trello-cli. " +
        "Use --repo <name> (repeatable) and let your caller resolve tiers from tier-config.json.",
    );
  }

  // Resolve any name-based filters to IDs upfront.
  const labelMap = await loadLabelMap(ctx.client, ctx.auth.boardId);
  const requiredLabelIds = filters.label
    ? new Set(resolveLabelIds(filters.label, labelMap))
    : null;
  const excludedLabelIds = filters.notLabel
    ? new Set(resolveLabelIds(filters.notLabel, labelMap))
    : null;

  let listIdFilter: string | null = null;
  if (filters.list) {
    const listMap = await loadListMap(ctx.client, ctx.auth.boardId);
    listIdFilter = resolveListId(filters.list, listMap);
  }

  let repoField: { id: string } | null = null;
  if (filters.repo && filters.repo.length > 0) {
    const fieldMap = await loadCustomFieldMap(ctx.client, ctx.auth.boardId);
    repoField = resolveCustomField("repo", fieldMap);
  }

  let myMemberId: string | null = null;
  if (filters.mine) {
    const me = await ctx.client.request<{ id: string }>("GET", "/members/me", {
      query: { fields: "id" },
    });
    myMemberId = me.id;
  }

  // Fetch — request customFieldItems if any filter or output cares about them.
  const cards = await ctx.client.cardsOnBoard(ctx.auth.boardId, {
    customFieldItems: repoField ? "true" : "false",
    fields: "all",
  });

  return cards.filter((card) => {
    if (requiredLabelIds) {
      for (const id of requiredLabelIds) {
        if (!card.idLabels.includes(id)) return false;
      }
    }
    if (excludedLabelIds) {
      for (const id of card.idLabels) {
        if (excludedLabelIds.has(id)) return false;
      }
    }
    if (listIdFilter && card.idList !== listIdFilter) return false;
    if (myMemberId && !card.idMembers.includes(myMemberId)) return false;

    if (repoField && filters.repo) {
      const item: TrelloCustomFieldItem | undefined = card.customFieldItems?.find(
        (i) => i.idCustomField === repoField!.id,
      );
      const repoValue = item?.value.text ?? "";
      if (!filters.repo.includes(repoValue)) return false;
    }

    if (filters.staleDays !== undefined && card.dateLastActivity) {
      const staleMs = filters.staleDays * 24 * 60 * 60 * 1000;
      const lastActivity = new Date(card.dateLastActivity).getTime();
      if (now.getTime() - lastActivity < staleMs) return false;
    }

    return true;
  });
}

export async function listCommand(opts: ListOptions): Promise<void> {
  const ctx = await loadContext();
  const cards = await listCards(ctx, opts);

  const mode = opts.format ?? "json";
  if (mode === "table") {
    process.stdout.write(
      `${format(
        cards.map((c) => ({
          id: c.id,
          name: c.name,
          list: c.idList,
          labels: c.idLabels.length,
          url: c.shortUrl,
        })),
        "table",
      )}\n`,
    );
  } else {
    process.stdout.write(`${format(cards, "json")}\n`);
  }
}
