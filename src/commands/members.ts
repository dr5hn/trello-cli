/**
 * `trello-cli members list` — list the people on the configured board.
 *
 * Mainly a discovery aid: `cards update --assign` accepts an id, username, or
 * full name, and this is how you look those up.
 */

import { type CommandContext, loadContext } from "../lib/context.js";
import { formatJson, formatTable, type OutputMode } from "../lib/output.js";

export interface MemberRow {
  id: string;
  username: string;
  fullName: string;
}

export interface MembersListOptions {
  format?: OutputMode;
}

/** Fetch the board's members as plain rows. */
export async function listMembers(ctx: CommandContext): Promise<MemberRow[]> {
  const members = await ctx.client.membersOnBoard(ctx.auth.boardId);
  return members.map((m) => ({ id: m.id, username: m.username, fullName: m.fullName }));
}

export async function membersListCommand(opts: MembersListOptions): Promise<void> {
  const ctx = await loadContext();
  const rows = await listMembers(ctx);
  const mode = opts.format ?? "json";
  if (mode === "table") {
    const tableRows: Array<Record<string, unknown>> = rows.map((r) => ({
      id: r.id,
      username: r.username,
      fullName: r.fullName,
    }));
    process.stdout.write(
      `${formatTable(tableRows, { columns: ["id", "username", "fullName"] })}\n`,
    );
  } else {
    process.stdout.write(`${formatJson(rows)}\n`);
  }
}
