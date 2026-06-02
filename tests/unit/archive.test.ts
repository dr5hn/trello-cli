import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { archive } from "../../src/commands/cards/archive.js";
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

function mockListsOnBoard() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/lists") })
    .reply(200, [
      { id: "list-done", idBoard: "B1", name: "Done", closed: false, pos: 1 },
    ]);
}

function mockCardsInList(cards: Array<{ id: string; name: string }>) {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/lists/list-done/cards") })
    .reply(200, cards);
}

function mockArchiveCard(cardId: string, name: string) {
  mockAgent
    .get(ORIGIN)
    .intercept({
      method: "PUT",
      path: (p) => p.startsWith(`/1/cards/${cardId}`) && p.includes("closed=true"),
    })
    .reply(200, { id: cardId, name });
}

describe("archive single card", () => {
  test("sets closed=true via PUT and returns the archived card", async () => {
    mockArchiveCard("C1", "My card");

    const result = await archive(ctx(), { cardId: "C1" });

    expect(result.source).toBe("card");
    expect(result.dryRun).toBe(false);
    expect(result.archived).toEqual([{ id: "C1", name: "My card" }]);
  });

  test("dry-run fetches the card name but does NOT mutate", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/cards/C1") })
      .reply(200, { id: "C1", name: "My card" });

    const result = await archive(ctx(), { cardId: "C1", dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.archived).toEqual([{ id: "C1", name: "My card" }]);
  });
});

describe("archive by list", () => {
  test("archives every open card in the named list", async () => {
    mockListsOnBoard();
    mockCardsInList([
      { id: "C1", name: "First" },
      { id: "C2", name: "Second" },
    ]);
    mockArchiveCard("C1", "First");
    mockArchiveCard("C2", "Second");

    const result = await archive(ctx(), { list: "Done" });

    expect(result.source).toBe("list");
    expect(result.dryRun).toBe(false);
    expect(result.archived.map((c) => c.id)).toEqual(["C1", "C2"]);
  });

  test("dry-run lists cards without archiving any", async () => {
    mockListsOnBoard();
    mockCardsInList([{ id: "C1", name: "First" }]);

    const result = await archive(ctx(), { list: "Done", dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.archived).toEqual([{ id: "C1", name: "First" }]);
  });

  test("unknown list name throws a helpful ResolutionError", async () => {
    mockListsOnBoard();

    await expect(archive(ctx(), { list: "Nope" })).rejects.toThrow(/Unknown list/);
  });
});

describe("archive validation", () => {
  test("requires either a card ID or --list", async () => {
    await expect(archive(ctx(), {})).rejects.toThrow(/card ID or --list/);
  });

  test("rejects providing both a card ID and --list", async () => {
    await expect(archive(ctx(), { cardId: "C1", list: "Done" })).rejects.toThrow(
      /not both/,
    );
  });
});
