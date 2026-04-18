/**
 * `trello-cli cards release` — atomic-ish state transition (spec §5.5).
 *
 * Three transitions:
 *   - pr-opened: add ww-pr-opened, remove ww-working, clear claimed-at, comment "PR-OPENED: <url>"
 *   - stuck:     add ww-stuck,     remove ww-working, clear claimed-at, comment "STUCK: <reason>"
 *   - done:      no label add, just remove ww-working + clear claimed-at
 *
 * Critical: clearing `claimed-at` is non-optional. A card moved manually back
 * to ww-ready after being stuck would be un-claimable forever otherwise.
 */

import pc from "picocolors";
import { type CommandContext } from "../../lib/context.js";
import {
  loadLabelMap,
  loadCustomFieldMap,
  ResolutionError,
} from "../../lib/resolve.js";
import { format, type OutputMode } from "../../lib/output.js";
import { loadContext } from "../../lib/context.js";

export type ReleaseStatus = "pr-opened" | "stuck" | "done";

const STATUS_LABEL: Record<ReleaseStatus, string | null> = {
  "pr-opened": "ww-pr-opened",
  stuck: "ww-stuck",
  done: null,
};

const WW_WORKING_LABEL = "ww-working";
const CLAIMED_AT_FIELD = "claimed-at";

export interface ReleaseOptions {
  cardId: string;
  status: ReleaseStatus;
  prUrl?: string;
  reason?: string;
}

export interface ReleaseResult {
  cardId: string;
  status: ReleaseStatus;
  labelAdded: string | null;
  labelRemoved: string;
  claimedAtCleared: boolean;
  commentPosted: string | null;
}

export async function release(
  ctx: CommandContext,
  opts: ReleaseOptions,
): Promise<ReleaseResult> {
  validateOptions(opts);

  const labels = await loadLabelMap(ctx.client, ctx.auth.boardId);
  const wwWorking = labels.get(WW_WORKING_LABEL);
  if (!wwWorking) {
    throw new ResolutionError(
      `Label "${WW_WORKING_LABEL}" not found on board. Run \`trello-cli labels ensure\` first.`,
    );
  }

  const statusLabelName = STATUS_LABEL[opts.status];
  let statusLabel = null;
  if (statusLabelName) {
    statusLabel = labels.get(statusLabelName);
    if (!statusLabel) {
      throw new ResolutionError(
        `Label "${statusLabelName}" not found on board. Run \`trello-cli labels ensure\` first.`,
      );
    }
  }

  const fields = await loadCustomFieldMap(ctx.client, ctx.auth.boardId);
  const claimedAtField = fields.get(CLAIMED_AT_FIELD);
  if (!claimedAtField) {
    throw new ResolutionError(
      `Custom field "${CLAIMED_AT_FIELD}" not found on board.`,
    );
  }

  // Order: label changes + field clear FIRST, then comment LAST so Butler
  // sees a clean post-release state when it reacts to the comment.

  // Step 1: add status label (skipped for "done")
  if (statusLabel) {
    await ctx.client.addLabelToCard(opts.cardId, statusLabel.id).catch((e) => {
      // Best-effort: a 400 here usually means the label is already on the card.
      // We continue rather than fail-closed.
      if (!is4xx(e)) throw e;
    });
  }

  // Step 2: remove ww-working
  await ctx.client.removeLabelFromCard(opts.cardId, wwWorking.id).catch((e) => {
    if (!is4xx(e)) throw e;
  });

  // Step 3: clear claimed-at
  await ctx.client.clearCustomField(opts.cardId, claimedAtField.id);

  // Step 4: post comment (last — Butler reacts to this)
  const commentText = composeComment(opts);
  if (commentText) {
    await ctx.client.addCommentToCard(opts.cardId, commentText);
  }

  return {
    cardId: opts.cardId,
    status: opts.status,
    labelAdded: statusLabel?.name ?? null,
    labelRemoved: WW_WORKING_LABEL,
    claimedAtCleared: true,
    commentPosted: commentText,
  };
}

function validateOptions(opts: ReleaseOptions): void {
  if (opts.status === "pr-opened" && (!opts.prUrl || opts.prUrl.length === 0)) {
    throw new Error("--pr-url is required when --status pr-opened");
  }
  if (opts.status === "stuck" && (!opts.reason || opts.reason.length === 0)) {
    throw new Error("--reason is required when --status stuck");
  }
}

function composeComment(opts: ReleaseOptions): string | null {
  switch (opts.status) {
    case "pr-opened":
      return `PR-OPENED: ${opts.prUrl}`;
    case "stuck":
      return `STUCK: ${opts.reason}`;
    case "done":
      return null;
  }
}

function is4xx(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number" &&
    (err as { status: number }).status >= 400 &&
    (err as { status: number }).status < 500
  );
}

// CLI handler

export interface ReleaseCommandOptions {
  cardId: string;
  status: ReleaseStatus;
  prUrl?: string;
  reason?: string;
  format?: OutputMode;
}

export async function releaseCommand(opts: ReleaseCommandOptions): Promise<void> {
  const ctx = await loadContext();
  const result = await release(ctx, {
    cardId: opts.cardId,
    status: opts.status,
    ...(opts.prUrl !== undefined ? { prUrl: opts.prUrl } : {}),
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
  });

  const mode = opts.format ?? "json";
  if (mode === "table") {
    process.stdout.write(
      `${pc.green("✓ released")} ${result.cardId} → ${result.status}` +
        `${result.labelAdded ? ` (added ${result.labelAdded})` : ""}\n`,
    );
  } else {
    process.stdout.write(`${format(result, "json")}\n`);
  }
}
