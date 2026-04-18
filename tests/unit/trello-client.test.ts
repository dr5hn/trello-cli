import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TrelloApiError } from "../../src/lib/errors.js";
import { RateLimitError, TokenBucket } from "../../src/lib/rate-limiter.js";

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

function intercept() {
  return mockAgent.get(ORIGIN);
}

function makeClient(maxRetries = 3): TrelloClient {
  return new TrelloClient({
    apiKey: "k",
    token: "t",
    bucket: new TokenBucket({ capacity: 100, refillPerSecond: 10_000 }), // effectively unlimited
    maxRetries,
  });
}

describe("TrelloClient.request", () => {
  test("GET attaches key + token + caller query params", async () => {
    intercept()
      .intercept({
        method: "GET",
        path: (p) =>
          p.startsWith("/1/boards/abc/cards") &&
          p.includes("key=k") &&
          p.includes("token=t") &&
          p.includes("filter=open"),
      })
      .reply(200, [{ id: "c1", name: "Card 1" }]);

    const client = makeClient();
    const cards = await client.cardsOnBoard("abc", { filter: "open" });
    expect(cards).toEqual([{ id: "c1", name: "Card 1" }]);
  });

  test("POST returns parsed JSON", async () => {
    intercept()
      .intercept({
        method: "POST",
        path: (p) => p.startsWith("/1/cards") && p.includes("name=New"),
      })
      .reply(200, { id: "new-card", name: "New" });

    const client = makeClient();
    const card = await client.createCard({ idList: "L1", name: "New" });
    expect(card.id).toBe("new-card");
  });

  test("204 No Content returns undefined", async () => {
    intercept()
      .intercept({
        method: "DELETE",
        path: (p) => p.startsWith("/1/cards/c1/idLabels/L1"),
      })
      .reply(204, "");

    const client = makeClient();
    await expect(client.removeLabelFromCard("c1", "L1")).resolves.toBeUndefined();
  });

  test("404 throws TrelloApiError carrying status, method, url", async () => {
    intercept()
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/cards/missing"),
      })
      .reply(404, { error: "card not found" });

    const client = makeClient();
    const err = await client.getCard("missing").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrelloApiError);
    expect((err as TrelloApiError).status).toBe(404);
    expect((err as TrelloApiError).method).toBe("GET");
    expect((err as TrelloApiError).url).toContain("/1/cards/missing");
  });

  test("429 retries and eventually succeeds", async () => {
    intercept()
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/abc/cards"),
      })
      .reply(429, "rate limited", { headers: { "retry-after": "0" } });

    intercept()
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/abc/cards"),
      })
      .reply(200, [{ id: "c1" }]);

    const client = makeClient();
    const cards = await client.cardsOnBoard("abc");
    expect(cards).toHaveLength(1);
  });

  test("429 exceeding maxRetries throws RateLimitError", async () => {
    const client = makeClient(2); // 2 retries → 3 attempts total
    for (let i = 0; i < 3; i++) {
      intercept()
        .intercept({
          method: "GET",
          path: (p) => p.startsWith("/1/boards/abc/cards"),
        })
        .reply(429, "rate limited", { headers: { "retry-after": "0" } });
    }
    const err = await client.cardsOnBoard("abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).status).toBe(429);
  });

  test("500 retries (transient)", async () => {
    intercept()
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/abc/cards"),
      })
      .reply(500, "boom");

    intercept()
      .intercept({
        method: "GET",
        path: (p) => p.startsWith("/1/boards/abc/cards"),
      })
      .reply(200, []);

    const client = makeClient();
    const result = await client.cardsOnBoard("abc");
    expect(result).toEqual([]);
  });

  test("addCommentToCard POSTs with text in query", async () => {
    intercept()
      .intercept({
        method: "POST",
        path: (p) =>
          p.startsWith("/1/cards/c1/actions/comments") && p.includes("text=hello+world"),
      })
      .reply(200, { id: "comment-1" });

    const client = makeClient();
    await expect(client.addCommentToCard("c1", "hello world")).resolves.toBeDefined();
  });

  test("setCustomFieldText sends JSON body { value: { text } }", async () => {
    intercept()
      .intercept({
        method: "PUT",
        path: (p) => p.startsWith("/1/cards/c1/customField/cf1/item"),
        body: (b) => {
          const parsed = JSON.parse(b);
          return (
            parsed.value !== undefined &&
            parsed.value.text === "the-value"
          );
        },
      })
      .reply(200, { id: "item1" });

    const client = makeClient();
    await client.setCustomFieldText("c1", "cf1", "the-value");
  });

  test("constructor rejects missing apiKey or token", () => {
    expect(() => new TrelloClient({ apiKey: "", token: "t" })).toThrow(/apiKey/);
    expect(() => new TrelloClient({ apiKey: "k", token: "" })).toThrow(/token/);
  });
});
