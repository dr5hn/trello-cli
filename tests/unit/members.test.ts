import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { listMembers } from "../../src/commands/members.js";
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

describe("listMembers", () => {
  test("returns id, username, and fullName for each board member", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/members") })
      .reply(200, [
        { id: "m-rahul", username: "rahulpawar", fullName: "Rahul Pawar" },
        { id: "m-aakash", username: "aakash424", fullName: "Aakash" },
      ]);

    const members = await listMembers(ctx());

    expect(members).toEqual([
      { id: "m-rahul", username: "rahulpawar", fullName: "Rahul Pawar" },
      { id: "m-aakash", username: "aakash424", fullName: "Aakash" },
    ]);
  });
});
