import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { listCards } from "../../src/commands/cards/list.js";
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

const NOW = new Date("2026-04-18T12:00:00.000Z");

const ALL_CARDS = [
  {
    id: "C1",
    name: "ready card on cli",
    idLabels: ["L-ready"],
    idMembers: ["M-me"],
    idList: "L-todo",
    idBoard: "B1",
    pos: 1,
    closed: false,
    url: "u",
    shortUrl: "u",
    desc: "",
    dateLastActivity: "2026-04-17T12:00:00.000Z", // 1 day ago
    customFieldItems: [
      { id: "I1", idCustomField: "F-repo", idModel: "C1", modelType: "card", value: { text: "csc-cli" } },
    ],
  },
  {
    id: "C2",
    name: "ready intern card",
    idLabels: ["L-ready", "L-intern"],
    idMembers: [],
    idList: "L-todo",
    idBoard: "B1",
    pos: 2,
    closed: false,
    url: "u",
    shortUrl: "u",
    desc: "",
    dateLastActivity: "2026-04-18T11:00:00.000Z", // 1 hour ago
    customFieldItems: [],
  },
  {
    id: "C3",
    name: "stuck card",
    idLabels: ["L-stuck"],
    idMembers: ["M-me"],
    idList: "L-progress",
    idBoard: "B1",
    pos: 1,
    closed: false,
    url: "u",
    shortUrl: "u",
    desc: "",
    dateLastActivity: "2026-04-01T00:00:00.000Z", // 17 days ago
    customFieldItems: [
      { id: "I3", idCustomField: "F-repo", idModel: "C3", modelType: "card", value: { text: "csc-docs" } },
    ],
  },
];

function mockLabels() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/labels") })
    .reply(200, [
      { id: "L-ready", idBoard: "B1", name: "ww-ready", color: "green" },
      { id: "L-intern", idBoard: "B1", name: "intern-ok", color: "sky" },
      { id: "L-stuck", idBoard: "B1", name: "ww-stuck", color: "red" },
    ]);
}

function mockCards() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/cards") })
    .reply(200, ALL_CARDS);
}

describe("listCards filters", () => {
  test("--label ww-ready returns only ready-labelled cards", async () => {
    mockLabels();
    mockCards();

    const cards = await listCards(ctx(), { label: ["ww-ready"] }, NOW);
    expect(cards.map((c) => c.id).sort()).toEqual(["C1", "C2"]);
  });

  test("--label ww-ready --not-label intern-ok excludes intern cards", async () => {
    mockLabels();
    mockCards();

    const cards = await listCards(
      ctx(),
      { label: ["ww-ready"], notLabel: ["intern-ok"] },
      NOW,
    );
    expect(cards.map((c) => c.id)).toEqual(["C1"]);
  });

  test("--mine returns only cards assigned to the authed user", async () => {
    mockLabels();
    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/members/me") })
      .reply(200, { id: "M-me" });
    mockCards();

    const cards = await listCards(ctx(), { mine: true }, NOW);
    expect(cards.map((c) => c.id).sort()).toEqual(["C1", "C3"]);
  });

  test("--stale-days 14 returns only cards untouched for 14+ days", async () => {
    mockLabels();
    mockCards();

    const cards = await listCards(ctx(), { staleDays: 14 }, NOW);
    expect(cards.map((c) => c.id)).toEqual(["C3"]);
  });

  test("--repo csc-cli filters by repo custom field exact match", async () => {
    mockLabels();
    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/customFields") })
      .reply(200, [
        { id: "F-repo", idModel: "B1", modelType: "board", name: "repo", type: "text", pos: 1 },
      ]);
    mockCards();

    const cards = await listCards(ctx(), { repo: ["csc-cli"] }, NOW);
    expect(cards.map((c) => c.id)).toEqual(["C1"]);
  });

  test("--tier returns a clear error directing to --repo (Phase 1 limitation)", async () => {
    await expect(listCards(ctx(), { tier: "green" }, NOW)).rejects.toThrow(/--repo/);
  });

  test("no filters returns all open cards", async () => {
    mockLabels();
    mockCards();

    const cards = await listCards(ctx(), {}, NOW);
    expect(cards).toHaveLength(3);
  });

  test("compound filter: --label ww-ready AND --not-label intern-ok AND --mine", async () => {
    mockLabels();
    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/members/me") })
      .reply(200, { id: "M-me" });
    mockCards();

    const cards = await listCards(
      ctx(),
      { label: ["ww-ready"], notLabel: ["intern-ok"], mine: true },
      NOW,
    );
    expect(cards.map((c) => c.id)).toEqual(["C1"]);
  });
});
