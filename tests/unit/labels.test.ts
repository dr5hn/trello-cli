import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { ensureLabels, WORKFLOW_LABELS } from "../../src/lib/labels.js";

const ORIGIN = "https://api.trello.com";

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeAll(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  mockAgent.assertNoPendingInterceptors();
});

afterAll(async () => {
  await mockAgent.close();
  setGlobalDispatcher(originalDispatcher);
});

function client(): TrelloClient {
  return new TrelloClient({
    apiKey: "k",
    token: "t",
    bucket: new TokenBucket({ capacity: 100, refillPerSecond: 10_000 }),
    maxRetries: 0,
  });
}

describe("ensureLabels", () => {
  test("creates all 8 labels when board has none", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/B1/labels"),
      })
      .reply(200, []);

    for (const def of WORKFLOW_LABELS) {
      mockAgent
        .get(ORIGIN)
        .intercept({
          method: "POST",
          path: (p) =>
            p.startsWith("/1/labels") &&
            p.includes(`name=${encodeURIComponent(def.name)}`),
        })
        .reply(200, { id: `id-${def.name}`, idBoard: "B1", name: def.name, color: def.color });
    }

    const result = await ensureLabels(client(), "B1");
    expect(result.created).toHaveLength(8);
    expect(result.existing).toHaveLength(0);
    expect(result.created.map((l) => l.name).sort()).toEqual(
      WORKFLOW_LABELS.map((d) => d.name).sort(),
    );
  });

  test("creates only the missing labels when some already exist", async () => {
    const preExisting = [
      { id: "x1", idBoard: "B1", name: "ww-ready", color: "green" },
      { id: "x2", idBoard: "B1", name: "intern-ok", color: "sky" },
      { id: "x3", idBoard: "B1", name: "some-other-label", color: "blue" },
    ];

    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/B1/labels"),
      })
      .reply(200, preExisting);

    // The 6 not-yet-present labels (8 - 2 = 6)
    const missing = WORKFLOW_LABELS.filter(
      (d) => !["ww-ready", "intern-ok"].includes(d.name),
    );
    for (const def of missing) {
      mockAgent
        .get(ORIGIN)
        .intercept({
          method: "POST",
          path: (p) =>
            p.startsWith("/1/labels") &&
            p.includes(`name=${encodeURIComponent(def.name)}`),
        })
        .reply(200, { id: `id-${def.name}`, idBoard: "B1", name: def.name, color: def.color });
    }

    const result = await ensureLabels(client(), "B1");
    expect(result.created).toHaveLength(6);
    expect(result.existing).toHaveLength(2);
    const existingNames = result.existing.map((l) => l.name).sort();
    expect(existingNames).toEqual(["intern-ok", "ww-ready"]);
  });

  test("idempotent: second run with all labels present creates nothing", async () => {
    const allPresent = WORKFLOW_LABELS.map((d, i) => ({
      id: `id-${i}`,
      idBoard: "B1",
      name: d.name,
      color: d.color,
    }));

    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/B1/labels"),
      })
      .reply(200, allPresent);

    const result = await ensureLabels(client(), "B1");
    expect(result.created).toHaveLength(0);
    expect(result.existing).toHaveLength(8);
  });

  test("ignores labels with empty name (Trello quirk: any colour can have unnamed labels)", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/B1/labels"),
      })
      .reply(200, [
        { id: "blank-1", idBoard: "B1", name: "", color: "yellow" },
        { id: "blank-2", idBoard: "B1", name: "", color: "purple" },
      ]);

    for (const def of WORKFLOW_LABELS) {
      mockAgent
        .get(ORIGIN)
        .intercept({
          method: "POST",
          path: (p) =>
            p.startsWith("/1/labels") &&
            p.includes(`name=${encodeURIComponent(def.name)}`),
        })
        .reply(200, { id: `id-${def.name}`, idBoard: "B1", name: def.name, color: def.color });
    }

    const result = await ensureLabels(client(), "B1");
    expect(result.created).toHaveLength(8); // blank labels don't count as matches
  });

  test("WORKFLOW_LABELS contains exactly the 8 spec'd workflow labels", () => {
    const names = WORKFLOW_LABELS.map((d) => d.name).sort();
    expect(names).toEqual(
      [
        "intern-ok",
        "stale",
        "ww-pr-opened",
        "ww-ready",
        "ww-stop-this-card",
        "ww-stuck",
        "ww-working",
        "ww-yellow-ok",
      ],
    );
  });
});
