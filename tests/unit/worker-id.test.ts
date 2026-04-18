import { describe, test, expect } from "vitest";
import {
  generateWorkerId,
  claimedAtStamp,
  workerIdFromStamp,
} from "../../src/lib/worker-id.js";

describe("generateWorkerId", () => {
  test("format = <hostname>:<pid>:<iso8601>", () => {
    const id = generateWorkerId();
    const parts = id.split(":");
    // hostname (no colons) : pid : ISO with colons inside
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[1]).toBe(String(process.pid));
    expect(id).toMatch(/:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("claimedAtStamp", () => {
  test("format = <workerId>:<iso8601>", () => {
    const wid = "host:1234:2026-04-18T10:00:00.000Z";
    const now = new Date("2026-04-18T11:00:00.000Z");
    expect(claimedAtStamp(wid, now)).toBe(`${wid}:2026-04-18T11:00:00.000Z`);
  });
});

describe("workerIdFromStamp", () => {
  test("extracts the workerId before the trailing ISO timestamp", () => {
    const wid = "host:1234:2026-04-18T10:00:00.000Z";
    const stamp = `${wid}:2026-04-18T11:00:00.000Z`;
    expect(workerIdFromStamp(stamp)).toBe(wid);
  });

  test("returns null for unparseable stamps", () => {
    expect(workerIdFromStamp("not-a-stamp")).toBeNull();
    expect(workerIdFromStamp("host:pid:no-iso")).toBeNull();
  });

  test("handles workerId without milliseconds in second timestamp", () => {
    const wid = "host:1234:2026-04-18T10:00:00.000Z";
    const stamp = `${wid}:2026-04-18T11:00:00Z`;
    expect(workerIdFromStamp(stamp)).toBe(wid);
  });
});
