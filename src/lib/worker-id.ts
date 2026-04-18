/**
 * Generate a worker identifier of the form `<hostname>:<pid>:<iso-timestamp>`.
 * Used by the claim protocol (§5.1.3) to attribute a claim to a specific
 * worker process and detect race-loss on re-check.
 */

import { hostname } from "node:os";

export function generateWorkerId(now: Date = new Date()): string {
  return `${hostname()}:${process.pid}:${now.toISOString()}`;
}

/** Compose `<workerId>:<iso-timestamp>` for the claimed-at field value. */
export function claimedAtStamp(workerId: string, now: Date = new Date()): string {
  return `${workerId}:${now.toISOString()}`;
}

/** Extract the worker-id portion from a claimed-at stamp (everything before the trailing ISO). */
export function workerIdFromStamp(stamp: string): string | null {
  // Stamp format: <hostname>:<pid>:<iso1>:<iso2> — workerId is hostname:pid:iso1
  // ISO timestamps have format YYYY-MM-DDTHH:MM:SS.sssZ — split on the last ":2026"-style year prefix.
  // Simpler approach: an ISO timestamp at the end matches /:\d{4}-\d{2}-\d{2}T/ followed by the rest.
  const match = stamp.match(/^(.+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/);
  return match ? match[1] ?? null : null;
}
