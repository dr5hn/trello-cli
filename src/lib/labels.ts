/**
 * Opinionated workflow label definitions for autonomous-worker integrations.
 * The 8 `ww-*` and adjacent labels carry workflow state on every card so a
 * worker process can claim, execute, release, and surface failures using
 * standard Trello label operations.
 *
 * `ensureLabels()` is idempotent: it lists existing labels, then creates
 * only those missing by exact name match. Returns what was created vs.
 * already-present so the caller can render an honest summary.
 *
 * If you don't run a worker, you can ignore this entirely — `labels ensure`
 * is opt-in.
 */

import { TrelloClient, type TrelloLabel, type TrelloLabelColor } from "../trello-client.js";

export interface WorkflowLabelDef {
  name: string;
  color: TrelloLabelColor | null;
  purpose: string;
}

export const WORKFLOW_LABELS: ReadonlyArray<WorkflowLabelDef> = [
  { name: "ww-ready", color: "green", purpose: "Card meets the worker's pickup criteria" },
  { name: "ww-working", color: "orange", purpose: "Worker has claimed and is actively executing" },
  { name: "ww-pr-opened", color: "purple", purpose: "Worker opened a PR; card awaits review" },
  { name: "ww-stuck", color: "red", purpose: "Worker tried and failed; needs human attention" },
  { name: "ww-yellow-ok", color: "yellow", purpose: "Per-card opt-in for Yellow-tier autonomous execution" },
  { name: "ww-stop-this-card", color: "black", purpose: "Halt worker on this card specifically" },
  { name: "intern-ok", color: "sky", purpose: "Card suitable for the intern; auto-assigns" },
  { name: "stale", color: null, purpose: "Card untouched for 14 days (set by Butler)" },
];

export interface EnsureLabelsResult {
  created: TrelloLabel[];
  existing: TrelloLabel[];
}

export async function ensureLabels(
  client: TrelloClient,
  boardId: string,
): Promise<EnsureLabelsResult> {
  const existingLabels = await client.labelsOnBoard(boardId);
  const byName = new Map<string, TrelloLabel>();
  for (const label of existingLabels) {
    if (label.name.length > 0) byName.set(label.name, label);
  }

  const created: TrelloLabel[] = [];
  const existing: TrelloLabel[] = [];

  for (const def of WORKFLOW_LABELS) {
    const found = byName.get(def.name);
    if (found) {
      existing.push(found);
      continue;
    }
    const newLabel = await client.createLabel({
      idBoard: boardId,
      name: def.name,
      color: def.color,
    });
    created.push(newLabel);
  }

  return { created, existing };
}
