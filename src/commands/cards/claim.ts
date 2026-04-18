/**
 * `trello-cli cards claim` — best-effort 4-step claim protocol (spec §5.1.3).
 *
 * Trello has no compare-and-swap, so this is best-effort assuming a
 * single-worker invariant (consumers must enforce this upstream — e.g. a
 * PID lockfile or a process manager that allows only one worker per board).
 * Two workers racing would each succeed steps 2-3 in interleaved order; the
 * step-4 re-check catches the loser and rolls back.
 */

import { type CommandContext } from "../../lib/context.js";
import { type TrelloCard, type TrelloCustomFieldItem } from "../../trello-client.js";
import { loadLabelMap, loadCustomFieldMap, ResolutionError } from "../../lib/resolve.js";
import { claimedAtStamp, generateWorkerId, workerIdFromStamp } from "../../lib/worker-id.js";

const WW_WORKING_LABEL = "ww-working";
const CLAIMED_AT_FIELD = "claimed-at";

export interface ClaimOptions {
  cardId: string;
  workerId?: string;
}

export interface ClaimResult {
  success: boolean;
  cardId: string;
  workerId: string;
  stamp?: string;
  reason?: string;
}

export async function claim(
  ctx: CommandContext,
  opts: ClaimOptions,
  now: Date = new Date(),
): Promise<ClaimResult> {
  const workerId = opts.workerId ?? generateWorkerId(now);

  // Resolve label and custom-field IDs once
  const labels = await loadLabelMap(ctx.client, ctx.auth.boardId);
  const wwWorking = labels.get(WW_WORKING_LABEL);
  if (!wwWorking) {
    throw new ResolutionError(
      `Label "${WW_WORKING_LABEL}" not found on board. Run \`trello-cli labels ensure\` first.`,
    );
  }

  const fields = await loadCustomFieldMap(ctx.client, ctx.auth.boardId);
  const claimedAtField = fields.get(CLAIMED_AT_FIELD);
  if (!claimedAtField) {
    throw new ResolutionError(
      `Custom field "${CLAIMED_AT_FIELD}" not found on board. ` +
        `Create a text custom field named "${CLAIMED_AT_FIELD}" on the board.`,
    );
  }

  // Step 1: read and check
  const card = await ctx.client.getCard(opts.cardId, {
    customFieldItems: "true",
    fields: "id,idLabels,name",
  });

  const existingItem = findCustomFieldItem(card, claimedAtField.id);
  const existingValue = existingItem?.value.text;
  if (existingValue && existingValue.length > 0) {
    return {
      success: false,
      cardId: opts.cardId,
      workerId,
      reason: `card already claimed by ${workerIdFromStamp(existingValue) ?? existingValue}`,
    };
  }
  if (card.idLabels.includes(wwWorking.id)) {
    return {
      success: false,
      cardId: opts.cardId,
      workerId,
      reason: `card already has "${WW_WORKING_LABEL}" label (stale claim?)`,
    };
  }

  // Step 2: write claimed-at
  const stamp = claimedAtStamp(workerId, now);
  await ctx.client.setCustomFieldText(opts.cardId, claimedAtField.id, stamp);

  // Step 3: add ww-working label
  await ctx.client.addLabelToCard(opts.cardId, wwWorking.id);

  // Step 4: re-read and verify (defends against the rare two-worker race)
  const recheck = await ctx.client.getCard(opts.cardId, {
    customFieldItems: "true",
    fields: "id,idLabels",
  });
  const recheckItem = findCustomFieldItem(recheck, claimedAtField.id);
  if (recheckItem?.value.text !== stamp) {
    // Race lost — best-effort rollback (don't throw; we've already lost the card)
    await ctx.client.clearCustomField(opts.cardId, claimedAtField.id).catch(() => {});
    await ctx.client.removeLabelFromCard(opts.cardId, wwWorking.id).catch(() => {});
    return {
      success: false,
      cardId: opts.cardId,
      workerId,
      reason: `race lost on re-check (claimed-at now contains a different stamp)`,
    };
  }

  return {
    success: true,
    cardId: opts.cardId,
    workerId,
    stamp,
  };
}

function findCustomFieldItem(card: TrelloCard, fieldId: string): TrelloCustomFieldItem | undefined {
  return card.customFieldItems?.find((i) => i.idCustomField === fieldId);
}

// CLI handler
import pc from "picocolors";
import { loadContext } from "../../lib/context.js";
import { format, type OutputMode } from "../../lib/output.js";

export interface ClaimCommandOptions {
  cardId: string;
  workerId?: string;
  format?: OutputMode;
}

export async function claimCommand(opts: ClaimCommandOptions): Promise<void> {
  const ctx = await loadContext();
  const result = await claim(ctx, {
    cardId: opts.cardId,
    ...(opts.workerId !== undefined ? { workerId: opts.workerId } : {}),
  });

  const mode = opts.format ?? "json";
  if (mode === "table") {
    if (result.success) {
      process.stdout.write(`${pc.green("✓ claimed")} ${result.cardId} (worker ${result.workerId})\n`);
    } else {
      process.stdout.write(`${pc.red("✗ claim failed")} ${result.cardId}: ${result.reason}\n`);
    }
  } else {
    process.stdout.write(`${format(result, "json")}\n`);
  }

  if (!result.success) process.exit(2);
}
