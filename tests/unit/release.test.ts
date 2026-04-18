import { describe, test, expect, beforeAll, afterEach, afterAll } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { release } from "../../src/commands/cards/release.js";
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

function mockBoardLabels() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/labels") })
    .reply(200, [
      { id: "L-working", idBoard: "B1", name: "ww-working", color: "orange" },
      { id: "L-pr", idBoard: "B1", name: "ww-pr-opened", color: "purple" },
      { id: "L-stuck", idBoard: "B1", name: "ww-stuck", color: "red" },
    ]);
}

function mockBoardCustomFields() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/customFields") })
    .reply(200, [
      { id: "F-claimed", idModel: "B1", modelType: "board", name: "claimed-at", type: "text", pos: 1 },
    ]);
}

function mockAddLabel(labelId: string) {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "POST", path: (p) => p.startsWith(`/1/cards/C1/idLabels`) && p.includes(`value=${labelId}`) })
    .reply(200, []);
}

function mockRemoveLabel(labelId: string) {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "DELETE", path: (p) => p.startsWith(`/1/cards/C1/idLabels/${labelId}`) })
    .reply(200, []);
}

function mockClearField() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "PUT", path: (p) => p.startsWith("/1/cards/C1/customField/F-claimed/item") })
    .reply(200, { id: "I1" });
}

function mockComment(textFragment: string) {
  mockAgent
    .get(ORIGIN)
    .intercept({
      method: "POST",
      path: (p) =>
        p.startsWith("/1/cards/C1/actions/comments") && p.includes(textFragment),
    })
    .reply(200, { id: "comment-1" });
}

describe("release status=pr-opened", () => {
  test("adds ww-pr-opened, removes ww-working, clears claimed-at, posts PR-OPENED comment", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockAddLabel("L-pr");
    mockRemoveLabel("L-working");
    mockClearField();
    mockComment("PR-OPENED");

    const result = await release(ctx(), {
      cardId: "C1",
      status: "pr-opened",
      prUrl: "https://github.com/x/y/pull/123",
    });

    expect(result.labelAdded).toBe("ww-pr-opened");
    expect(result.labelRemoved).toBe("ww-working");
    expect(result.claimedAtCleared).toBe(true);
    expect(result.commentPosted).toBe("PR-OPENED: https://github.com/x/y/pull/123");
  });

  test("requires --pr-url", async () => {
    await expect(
      release(ctx(), { cardId: "C1", status: "pr-opened" }),
    ).rejects.toThrow(/--pr-url is required/);
  });
});

describe("release status=stuck", () => {
  test("adds ww-stuck, removes ww-working, clears claimed-at, posts STUCK comment with reason", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockAddLabel("L-stuck");
    mockRemoveLabel("L-working");
    mockClearField();
    mockComment("STUCK");

    const result = await release(ctx(), {
      cardId: "C1",
      status: "stuck",
      reason: "tests failed: 3 of 12 specs",
    });

    expect(result.labelAdded).toBe("ww-stuck");
    expect(result.commentPosted).toContain("STUCK");
    expect(result.commentPosted).toContain("tests failed");
  });

  test("requires --reason", async () => {
    await expect(
      release(ctx(), { cardId: "C1", status: "stuck" }),
    ).rejects.toThrow(/--reason is required/);
  });
});

describe("release status=done", () => {
  test("removes ww-working and clears claimed-at; no label add, no comment", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockRemoveLabel("L-working");
    mockClearField();

    const result = await release(ctx(), { cardId: "C1", status: "done" });

    expect(result.labelAdded).toBeNull();
    expect(result.labelRemoved).toBe("ww-working");
    expect(result.claimedAtCleared).toBe(true);
    expect(result.commentPosted).toBeNull();
  });
});

describe("release — claimed-at clearing is mandatory", () => {
  test("result always reports claimedAtCleared=true (manually-rescued cards must be re-claimable)", async () => {
    mockBoardLabels();
    mockBoardCustomFields();
    mockRemoveLabel("L-working");
    mockClearField();

    const result = await release(ctx(), { cardId: "C1", status: "done" });
    expect(result.claimedAtCleared).toBe(true);
  });
});
