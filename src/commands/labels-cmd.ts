/**
 * `trello-cli labels ensure` — idempotently create the 8 ww-* workflow labels.
 * The underlying logic lives in src/lib/labels.ts (shared with init).
 */

import pc from "picocolors";
import { loadContext } from "../lib/context.js";
import { ensureLabels } from "../lib/labels.js";
import { format, type OutputMode } from "../lib/output.js";

export interface LabelsEnsureOptions {
  format?: OutputMode;
}

export async function labelsEnsureCommand(opts: LabelsEnsureOptions): Promise<void> {
  const ctx = await loadContext();
  const result = await ensureLabels(ctx.client, ctx.auth.boardId);

  const mode = opts.format ?? "json";
  if (mode === "json") {
    process.stdout.write(
      `${format(
        {
          created: result.created.map((l) => ({ id: l.id, name: l.name, color: l.color })),
          existing: result.existing.map((l) => ({ id: l.id, name: l.name, color: l.color })),
        },
        "json",
      )}\n`,
    );
  } else {
    process.stdout.write(
      `${pc.green("✓")} Labels: ${result.created.length} created, ${result.existing.length} already present\n`,
    );
    if (result.created.length > 0) {
      process.stdout.write(`Created:\n`);
      for (const l of result.created) {
        process.stdout.write(`  ${l.name}${l.color ? ` (${l.color})` : ""}\n`);
      }
    }
  }
}
