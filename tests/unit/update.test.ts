import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { update } from "../../src/commands/cards/update.js";
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

function mockMembers() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/members") })
    .reply(200, [
      { id: "m-rahul", username: "rahulpawar", fullName: "Rahul Pawar" },
      { id: "m-aakash", username: "aakash424", fullName: "Aakash" },
    ]);
}

function mockLabels() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/labels") })
    .reply(200, [
      { id: "L-working", idBoard: "B1", name: "ww-working", color: "orange" },
      { id: "L-orange", idBoard: "B1", name: "", color: "orange" },
    ]);
}

describe("update — name and description", () => {
  test("renames and sets description in a single card PUT", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "PUT",
        path: (p) =>
          p.startsWith("/1/cards/C1") &&
          p.includes("name=Fixed+title") &&
          p.includes("desc="),
      })
      .reply(200, { id: "C1", name: "Fixed title" });

    const result = await update(ctx(), {
      cardId: "C1",
      name: "Fixed title",
      description: "Now with details",
    });

    expect(result.renamed).toBe("Fixed title");
    expect(result.descriptionSet).toBe(true);
  });
});

describe("update — assign / unassign members", () => {
  test("assigns a member resolved by username", async () => {
    mockMembers();
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "POST",
        path: (p) => p.startsWith("/1/cards/C1/idMembers") && p.includes("value=m-rahul"),
      })
      .reply(200, []);

    const result = await update(ctx(), { cardId: "C1", assign: ["rahulpawar"] });
    expect(result.membersAdded).toEqual(["rahulpawar"]);
  });

  test("unassigns a member resolved by full name", async () => {
    mockMembers();
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "DELETE",
        path: (p) => p.startsWith("/1/cards/C1/idMembers/m-rahul"),
      })
      .reply(200, []);

    const result = await update(ctx(), { cardId: "C1", unassign: ["Rahul Pawar"] });
    expect(result.membersRemoved).toEqual(["Rahul Pawar"]);
  });
});

describe("update — add label by colour", () => {
  test("adds the unnamed orange category label via the bare colour token", async () => {
    mockLabels();
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "POST",
        path: (p) => p.startsWith("/1/cards/C1/idLabels") && p.includes("value=L-orange"),
      })
      .reply(200, []);

    const result = await update(ctx(), { cardId: "C1", addLabel: ["orange"] });
    expect(result.labelsAdded).toEqual(["orange"]);
  });
});
