import { describe, test, expect } from "vitest";
import { parseDuration } from "../../src/commands/watch.js";

describe("parseDuration", () => {
  test("ms suffix", () => {
    expect(parseDuration("1500ms")).toBe(1500);
  });

  test("s suffix", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  test("m suffix", () => {
    expect(parseDuration("15m")).toBe(15 * 60_000);
  });

  test("h suffix", () => {
    expect(parseDuration("2h")).toBe(2 * 60 * 60_000);
  });

  test("bare number defaults to ms", () => {
    expect(parseDuration("500")).toBe(500);
  });

  test("decimal value", () => {
    expect(parseDuration("0.5h")).toBe(30 * 60_000);
  });

  test("whitespace around value or unit is tolerated", () => {
    expect(parseDuration("  15 m  ")).toBe(15 * 60_000);
  });

  test("rejects garbage with helpful message", () => {
    expect(() => parseDuration("forever")).toThrow(/Invalid --interval/);
    expect(() => parseDuration("15days")).toThrow(/Invalid --interval/);
  });
});
