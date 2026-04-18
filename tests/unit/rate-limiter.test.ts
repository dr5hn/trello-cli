import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenBucket, nextBackoffMs, isRateLimitError, RateLimitError } from "../../src/lib/rate-limiter.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("take(1) resolves immediately when bucket starts at capacity", async () => {
    const bucket = new TokenBucket({ capacity: 100, refillPerSecond: 25 });
    await expect(bucket.take(1)).resolves.toBeUndefined();
    expect(bucket.available).toBeCloseTo(99, 0);
  });

  test("burst: 100 immediate takes succeed without delay", async () => {
    const bucket = new TokenBucket({ capacity: 100, refillPerSecond: 25 });
    for (let i = 0; i < 100; i++) {
      await bucket.take(1);
    }
    expect(bucket.available).toBeLessThan(1);
  });

  test("take(101) on a fresh bucket waits for refill of 1 extra token (~40ms)", async () => {
    const bucket = new TokenBucket({ capacity: 100, refillPerSecond: 25 });
    // drain capacity
    for (let i = 0; i < 100; i++) await bucket.take(1);

    let resolved = false;
    const p = bucket.take(1).then(() => {
      resolved = true;
    });

    // not yet
    await vi.advanceTimersByTimeAsync(20);
    expect(resolved).toBe(false);

    // ~40ms = 1/25 of a second = 1 token
    await vi.advanceTimersByTimeAsync(30);
    await p;
    expect(resolved).toBe(true);
  });

  test("refill caps at capacity — long idle does not exceed capacity", async () => {
    const bucket = new TokenBucket({ capacity: 100, refillPerSecond: 25 });
    await bucket.take(50);
    // simulate 1 hour of idle
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(bucket.available).toBeLessThanOrEqual(100);
  });

  test("take(N) where N > capacity rejects (would never resolve otherwise)", async () => {
    const bucket = new TokenBucket({ capacity: 100, refillPerSecond: 25 });
    await expect(bucket.take(101)).rejects.toThrow(/exceeds capacity/);
  });
});

describe("nextBackoffMs", () => {
  test("first attempt → 1s", () => {
    expect(nextBackoffMs(0)).toBe(1000);
  });

  test("doubles each attempt", () => {
    expect(nextBackoffMs(1)).toBe(2000);
    expect(nextBackoffMs(2)).toBe(4000);
    expect(nextBackoffMs(3)).toBe(8000);
    expect(nextBackoffMs(4)).toBe(16000);
  });

  test("caps at 30s", () => {
    expect(nextBackoffMs(5)).toBe(30000);
    expect(nextBackoffMs(10)).toBe(30000);
    expect(nextBackoffMs(100)).toBe(30000);
  });

  test("retryAfterSec overrides exponential backoff", () => {
    expect(nextBackoffMs(0, 5)).toBe(5000);
    expect(nextBackoffMs(3, 2)).toBe(2000);
  });

  test("retryAfterSec is also capped at 30s (defensive against bad upstream values)", () => {
    expect(nextBackoffMs(0, 600)).toBe(30000);
  });

  test("retryAfterSec ≤ 0 falls back to exponential", () => {
    expect(nextBackoffMs(2, 0)).toBe(4000);
    expect(nextBackoffMs(2, -5)).toBe(4000);
  });
});

describe("RateLimitError + isRateLimitError", () => {
  test("RateLimitError carries status and retryAfter", () => {
    const e = new RateLimitError("rate limited", { status: 429, retryAfterSec: 5 });
    expect(e.status).toBe(429);
    expect(e.retryAfterSec).toBe(5);
    expect(e.name).toBe("RateLimitError");
  });

  test("isRateLimitError true only for RateLimitError instances", () => {
    expect(isRateLimitError(new RateLimitError("x", { status: 429 }))).toBe(true);
    expect(isRateLimitError(new Error("nope"))).toBe(false);
    expect(isRateLimitError("string")).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});
