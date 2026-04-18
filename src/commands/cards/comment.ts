/**
 * `trello-cli cards comment <id>` — add a comment to a card.
 *
 * Body sources (mutually exclusive): --body "text" or --from-stdin.
 */

import { loadContext } from "../../lib/context.js";
import { format, type OutputMode } from "../../lib/output.js";

export interface CommentOptions {
  cardId: string;
  body?: string;
  fromStdin?: boolean;
  format?: OutputMode;
}

export async function commentCommand(opts: CommentOptions): Promise<void> {
  if (opts.body && opts.fromStdin) {
    throw new Error("--body and --from-stdin are mutually exclusive");
  }
  if (!opts.body && !opts.fromStdin) {
    throw new Error("provide --body \"text\" or --from-stdin");
  }

  const text = opts.fromStdin ? await readStdin() : (opts.body ?? "");
  if (text.trim().length === 0) {
    throw new Error("comment body is empty");
  }

  const ctx = await loadContext();
  const result = await ctx.client.addCommentToCard(opts.cardId, text);
  process.stdout.write(`${format(result, opts.format ?? "json")}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
