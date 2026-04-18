import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { claim } from "../../src/commands/cards/claim.js";
import { ResolutionError } from "../../src/lib/resolve.js";
import type { CommandContext } from "../../src/lib/context.js";
import type { Auth } from "../../src/lib/auth.js";

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

const NOW = new Date("2026-04-18T11:00:00.000Z");
const WORKER_ID = "test-host:1234:2026-04-18T10:00:00.000Z";
const STAMP = `${WORKER_ID}:2026-04-18T11:00:00.000Z`;

const auth: Auth = {
  apiKey: "k",
  token: "t",
  boardId: "B1",
  internal_lists: ["📊 Internal"],
};

function ctx(): CommandContext {
  return {
    auth,
    client: new TrelloClient({
      apiKey: "k",
      token: "t",
      bucket: new TokenBucket({ capacity: 1000, refillPerSecond: 10_000 }),
      maxRetries: 0,
    }),
  };
}

function mockBoardLabels(includeWwWorking = true) {
  const labels = includeWwWorking
    ? [
        { id: "L-ready", idBoard: "B1", name: "ww-ready", color: "green" },
        { id: "L-working", idBoard: "B1", name: "ww-working", color: "orange" },
      ]
    : [{ id: "L-ready", idBoard: "B1", name: "ww-ready", color: "green" }];
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/labels") })
    .reply(200, labels);
}

function mockBoardCustomFields(includeClaimedAt = true) {
  const fields = includeClaimedAt
    ? [{ id: "F-claimed", idModel: "B1", modelType: "board", name: "claimed-at", type: "text", pos: 1 }]
    : [];
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/customFields") })
    .reply(200, fields);
}

interface CardOptions {
  idLabels?: string[];
  claimedAtValue?: string;
}

function mockGetCard(opts: CardOptions = {}) {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/cards/C1") })
    .reply(200, {
      id: "C1",
      name: "Card 1",
      idLabels: opts.idLabels ?? [],
      idBoard: "B1",
      idList: "L-todo",
      idMembers: [],
      pos: 1,
      closed: false,
      url: "u",
      shortUrl: "u",
      desc: "",
      customFieldItems: opts.claimedAtValue
        ? [{ id: "I1", idCustomField: "F-claimed", idModel: "C1", modelType: "card", value: { text: opts.claimedAtValue } }]
        : [],
    });
}

function mockSetCustomField() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "PUT", path: (p) => p.startsWith("/1/cards/C1/customField/F-claimed/item") })
    .reply(200, { id: "I1" });
}

function mockAddLabel() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "POST", path: (p) => p.startsWith("/1/cards/C1/idLabels") })
    .reply(200, ["L-working"]);
}

function mockClearCustomField() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "PUT", path: (p) => p.startsWith("/1/cards/C1/customField/F-claimed/item") })
    .reply(200, { id: "I1" });
}

function mockRemoveLabel() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "DELETE", path: (p) => p.startsWith("/1/cards/C1/idLabels/L-working") })
    .reply(200, "");
}

describe("claim — happy path", () => {
  test("unclaimed card succeeds; result.stamp matches our worker-id", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockGetCard(); // step 1: empty state
    mockSetCustomField(); // step 2
    mockAddLabel(); // step 3
    mockGetCard({ idLabels: ["L-working"], claimedAtValue: STAMP }); // step 4: re-read confirms

    const result = await claim(ctx(), { cardId: "C1", workerId: WORKER_ID }, NOW);
    expect(result.success).toBe(true);
    expect(result.cardId).toBe("C1");
    expect(result.workerId).toBe(WORKER_ID);
    expect(result.stamp).toBe(STAMP);
  });
});

describe("claim — already-claimed paths", () => {
  test("returns failure when claimed-at field is non-empty", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockGetCard({ claimedAtValue: "other-host:9999:2026-04-18T09:00:00.000Z:2026-04-18T09:01:00.000Z" });

    const result = await claim(ctx(), { cardId: "C1", workerId: WORKER_ID }, NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("already claimed");
    expect(result.reason).toContain("other-host");
  });

  test("returns failure when ww-working label is present (stale claim)", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockGetCard({ idLabels: ["L-working"] }); // label present but field empty

    const result = await claim(ctx(), { cardId: "C1", workerId: WORKER_ID }, NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("already has");
    expect(result.reason).toContain("ww-working");
  });
});

describe("claim — race-detection on re-check", () => {
  test("rolls back if re-read shows a different stamp", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockGetCard(); // step 1: empty
    mockSetCustomField(); // step 2
    mockAddLabel(); // step 3
    mockGetCard({
      idLabels: ["L-working"],
      claimedAtValue: "other-worker:9999:2026-04-18T11:00:00.000Z:2026-04-18T11:00:00.005Z",
    }); // step 4: someone else's stamp now
    mockClearCustomField(); // rollback step 1
    mockRemoveLabel(); // rollback step 2

    const result = await claim(ctx(), { cardId: "C1", workerId: WORKER_ID }, NOW);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("race lost");
  });
});

describe("claim — board misconfiguration", () => {
  test("throws ResolutionError when ww-working label not on board", async () => {
    mockBoardLabels(false);

    const err = await claim(ctx(), { cardId: "C1", workerId: WORKER_ID }, NOW).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ResolutionError);
    expect((err as Error).message).toMatch(/ww-working/);
    expect((err as Error).message).toMatch(/labels ensure/);
  });

  test("throws ResolutionError when claimed-at custom field not on board", async () => {
    mockBoardLabels();
    mockBoardCustomFields(false);

    const err = await claim(ctx(), { cardId: "C1", workerId: WORKER_ID }, NOW).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ResolutionError);
    expect((err as Error).message).toMatch(/claimed-at/);
  });
});
