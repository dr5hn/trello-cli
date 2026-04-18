import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import {
  ensureInternalList,
  ensureStatusCard,
  INTERNAL_LIST_NAME,
  STATUS_CARD_NAME,
  INITIAL_STATUS_PAYLOAD,
} from "../../src/lib/board-setup.js";

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

describe("ensureInternalList", () => {
  test("creates 📊 Internal list when board has no matching list", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/B1/lists"),
      })
      .reply(200, [
        { id: "L1", idBoard: "B1", name: "Todo", closed: false, pos: 1 },
      ]);

    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "POST",
        path: (p) =>
          p.startsWith("/1/lists") &&
          p.includes("idBoard=B1") && p.includes("Internal"),
      })
      .reply(200, {
        id: "L99",
        idBoard: "B1",
        name: INTERNAL_LIST_NAME,
        closed: false,
        pos: 99,
      });

    const result = await ensureInternalList(client(), "B1");
    expect(result.created).toBe(true);
    expect(result.resource.name).toBe(INTERNAL_LIST_NAME);
    expect(result.resource.id).toBe("L99");
  });

  test("returns existing list without creating duplicate", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/B1/lists"),
      })
      .reply(200, [
        { id: "L42", idBoard: "B1", name: INTERNAL_LIST_NAME, closed: false, pos: 99 },
      ]);

    const result = await ensureInternalList(client(), "B1");
    expect(result.created).toBe(false);
    expect(result.resource.id).toBe("L42");
  });

  test("matches by exact name — partial match doesn't count", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/B1/lists"),
      })
      .reply(200, [
        { id: "L1", idBoard: "B1", name: "📊 Internal Notes", closed: false, pos: 1 },
      ]);

    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "POST",
        path: (p) =>
          p.startsWith("/1/lists") &&
          p.includes("idBoard=B1") && p.includes("Internal"),
      })
      .reply(200, {
        id: "L99",
        idBoard: "B1",
        name: INTERNAL_LIST_NAME,
        closed: false,
        pos: 99,
      });

    const result = await ensureInternalList(client(), "B1");
    expect(result.created).toBe(true);
  });
});

describe("ensureStatusCard", () => {
  test("creates the status card with INITIAL_STATUS_PAYLOAD as description", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/lists/L99/cards"),
      })
      .reply(200, []);

    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "POST",
        path: (p) =>
          p.startsWith("/1/cards") &&
          p.includes("idList=L99") && p.includes("Worker") && p.includes("Status"),
      })
      .reply(200, {
        id: "C-status",
        name: STATUS_CARD_NAME,
        desc: JSON.stringify(INITIAL_STATUS_PAYLOAD, null, 2),
        idList: "L99",
        idBoard: "B1",
        idLabels: [],
        idMembers: [],
        pos: 1,
        closed: false,
        url: "https://trello.com/c/x",
        shortUrl: "https://trello.com/c/x",
      });

    const result = await ensureStatusCard(client(), "L99");
    expect(result.created).toBe(true);
    expect(result.resource.name).toBe(STATUS_CARD_NAME);
  });

  test("returns existing status card without recreating", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/lists/L99/cards"),
      })
      .reply(200, [
        {
          id: "C-existing",
          name: STATUS_CARD_NAME,
          desc: '{"lastTickAt":"2026-04-18T10:00:00+05:30"}',
          idList: "L99",
          idBoard: "B1",
          idLabels: [],
          idMembers: [],
          pos: 1,
          closed: false,
          url: "x",
          shortUrl: "x",
        },
      ]);

    const result = await ensureStatusCard(client(), "L99");
    expect(result.created).toBe(false);
    expect(result.resource.id).toBe("C-existing");
  });

  test("INITIAL_STATUS_PAYLOAD does not contain workerId (privacy contract §5.7)", () => {
    expect(INITIAL_STATUS_PAYLOAD).not.toHaveProperty("workerId");
    expect(INITIAL_STATUS_PAYLOAD).not.toHaveProperty("hostname");
    expect(INITIAL_STATUS_PAYLOAD).not.toHaveProperty("pid");
  });

  test("INITIAL_STATUS_PAYLOAD has the 6 documented fields", () => {
    expect(Object.keys(INITIAL_STATUS_PAYLOAD).sort()).toEqual([
      "backpressureEvents",
      "inFlightCount",
      "killSwitchEngaged",
      "lastTickAt",
      "todaysPrs",
      "todaysStuck",
    ]);
  });
});
