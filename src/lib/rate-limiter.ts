/**
 * Token-bucket rate limiter for the Trello API.
 *
 * Trello enforces 300 requests per 10 seconds per token (server-side).
 * Default config: 25 req/s steady-state, burst capacity 100 — gives ~17% headroom.
 *
 * Single-process only. Cross-process coordination (e.g., a long-running
 * `trello-cli watch` plus the worker loop) is documented as a future addition
 * via proper-lockfile; for Phase 1 (single worker per board, infrequent slash
 * commands) per-process buckets are sufficient.
 */

export interface TokenBucketOptions {
  /** Maximum tokens the bucket can hold. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export class TokenBucket {
  readonly capacity: number;
  readonly refillPerSecond: number;
  private tokens: number;
  private lastRefillAt: number;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error("capacity must be > 0");
    if (opts.refillPerSecond <= 0) throw new Error("refillPerSecond must be > 0");
    this.capacity = opts.capacity;
    this.refillPerSecond = opts.refillPerSecond;
    this.tokens = opts.capacity;
    this.lastRefillAt = Date.now();
  }

  /** Tokens currently available (refilled to current time). */
  get available(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Acquire `count` tokens, waiting if necessary.
   * Throws synchronously if `count > capacity` (would never resolve).
   */
  async take(count = 1): Promise<void> {
    if (count > this.capacity) {
      throw new Error(`take(${count}) exceeds capacity ${this.capacity}`);
    }
    while (true) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }
      const deficit = count - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillPerSecond) * 1000);
      await sleep(waitMs);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillAt) / 1000;
    if (elapsedSec <= 0) return;
    const refilled = elapsedSec * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refilled);
    this.lastRefillAt = now;
  }
}

/** sleep using setTimeout — cooperates with vitest fake timers. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute the next backoff delay (ms) for an HTTP 429 / 5xx retry.
 *
 * Exponential progression: 1s, 2s, 4s, 8s, 16s, then capped at 30s.
 * `retryAfterSec`, when present and > 0, overrides exponential backoff
 * (also capped at 30s as defence against pathological upstream values).
 */
export function nextBackoffMs(attempt: number, retryAfterSec?: number): number {
  const HARD_CAP_MS = 30_000;
  if (retryAfterSec !== undefined && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, HARD_CAP_MS);
  }
  const exponential = Math.pow(2, Math.max(0, attempt)) * 1000;
  return Math.min(exponential, HARD_CAP_MS);
}

export interface RateLimitErrorOptions {
  status: number;
  retryAfterSec?: number;
  body?: unknown;
}

export class RateLimitError extends Error {
  override readonly name = "RateLimitError";
  readonly status: number;
  readonly retryAfterSec?: number;
  readonly body?: unknown;

  constructor(message: string, opts: RateLimitErrorOptions) {
    super(message);
    this.status = opts.status;
    if (opts.retryAfterSec !== undefined) this.retryAfterSec = opts.retryAfterSec;
    if (opts.body !== undefined) this.body = opts.body;
  }
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof RateLimitError;
}
