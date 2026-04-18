import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { summarise } from "../../src/commands/board.js";
import { saveAuth } from "../../src/lib/auth.js";

const ORIGIN = "https://api.trello.com";

let mockAgent: MockAgent;
let originalDispatcher: Dispatcher;

beforeAll(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterAll(async () => {
  await mockAgent.close();
  setGlobalDispatcher(originalDispatcher);
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trello-cli-summary-"));
  process.env["TRELLO_CLI_AUTH_PATH"] = join(dir, "auth.json");
  await saveAuth(
    {
      apiKey: "k",
      token: "t",
      boardId: "B1",
      internal_lists: ["📊 Internal"],
    },
    process.env["TRELLO_CLI_AUTH_PATH"],
  );
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
  delete process.env["TRELLO_CLI_AUTH_PATH"];
});

describe("summarise", () => {
  test("returns counts and excludes the 📊 Internal list from totals", async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1") && p.includes("fields=id%2Cname") })
      .reply(200, { id: "B1", name: "Test Board" });

    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/lists") })
      .reply(200, [
        { id: "L-todo", idBoard: "B1", name: "Todo", closed: false, pos: 1 },
        { id: "L-done", idBoard: "B1", name: "Done", closed: false, pos: 5 },
        { id: "L-internal", idBoard: "B1", name: "📊 Internal", closed: false, pos: 99 },
      ]);

    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/labels") })
      .reply(200, [
        { id: "L-ready", idBoard: "B1", name: "ww-ready", color: "green" },
        { id: "L-stale", idBoard: "B1", name: "stale", color: null },
      ]);

    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/cards") })
      .reply(200, [
        { id: "C1", name: "real-card-1", idList: "L-todo", idLabels: ["L-ready"], idMembers: [], idBoard: "B1", pos: 1, closed: false, url: "u", shortUrl: "u", desc: "" },
        { id: "C2", name: "real-card-2", idList: "L-todo", idLabels: ["L-ready", "L-stale"], idMembers: [], idBoard: "B1", pos: 2, closed: false, url: "u", shortUrl: "u", desc: "" },
        { id: "C3", name: "real-card-3", idList: "L-done", idLabels: [], idMembers: [], idBoard: "B1", pos: 1, closed: false, url: "u", shortUrl: "u", desc: "" },
        // The status card lives in 📊 Internal — must NOT show up in totals
        { id: "C-status", name: "📊 WW Worker Status", idList: "L-internal", idLabels: [], idMembers: [], idBoard: "B1", pos: 1, closed: false, url: "u", shortUrl: "u", desc: "" },
      ]);

    const summary = await summarise();

    expect(summary.board.name).toBe("Test Board");
    expect(summary.totalCards).toBe(3); // status card excluded
    expect(summary.internalListsExcluded).toEqual(["📊 Internal"]);

    const todoList = summary.lists.find((l) => l.name === "Todo");
    expect(todoList?.cardCount).toBe(2);
    const doneList = summary.lists.find((l) => l.name === "Done");
    expect(doneList?.cardCount).toBe(1);
    expect(summary.lists.find((l) => l.name === "📊 Internal")).toBeUndefined();

    const readyLabel = summary.labels.find((l) => l.name === "ww-ready");
    expect(readyLabel?.cardCount).toBe(2);
    const staleLabel = summary.labels.find((l) => l.name === "stale");
    expect(staleLabel?.cardCount).toBe(1);

    expect(summary.generatedAt).toBe("2026-04-18T12:00:00.000Z");
  });
});
