/**
 * `trello-cli cards get <id>` — fetch full card detail with custom fields.
 */

import { loadContext } from "../../lib/context.js";
import { format, type OutputMode } from "../../lib/output.js";

export interface GetOptions {
  cardId: string;
  format?: OutputMode;
}

export async function getCommand(opts: GetOptions): Promise<void> {
  const ctx = await loadContext();
  const card = await ctx.client.getCard(opts.cardId, {
    customFieldItems: "true",
    fields: "all",
  });
  process.stdout.write(`${format(card, opts.format ?? "json")}\n`);
}
