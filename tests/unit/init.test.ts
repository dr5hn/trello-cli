import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TrelloClient } from "../../src/trello-client.js";
import { TokenBucket } from "../../src/lib/rate-limiter.js";
import { runInit } from "../../src/commands/init.js";
import { AuthError } from "../../src/lib/auth.js";
import { WORKFLOW_LABELS } from "../../src/lib/labels.js";
import { INTERNAL_LIST_NAME, STATUS_CARD_NAME } from "../../src/lib/board-setup.js";

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
let authPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trello-cli-init-"));
  authPath = join(dir, "auth.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function client(): TrelloClient {
  return new TrelloClient({
    apiKey: "k",
    token: "t",
    bucket: new TokenBucket({ capacity: 1000, refillPerSecond: 10_000 }),
    maxRetries: 0,
  });
}

function mockGetBoard() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1") && p.includes("fields") })
    .reply(200, { id: "B1", name: "Test Board", closed: false, url: "u", shortUrl: "u" });
}

function mockEmptyLabelsThenCreate8() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/labels") })
    .reply(200, []);
  for (const def of WORKFLOW_LABELS) {
    mockAgent
      .get(ORIGIN)
      .intercept({
        method: "POST",
        path: (p) => p.startsWith("/1/labels") && p.includes(def.name),
      })
      .reply(200, { id: `id-${def.name}`, idBoard: "B1", name: def.name, color: def.color });
  }
}

function mockEmptyListsThenCreateInternal() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/lists") })
    .reply(200, []);
  mockAgent
    .get(ORIGIN)
    .intercept({
      method: "POST",
      path: (p) => p.startsWith("/1/lists") && p.includes("Internal"),
    })
    .reply(200, { id: "L99", idBoard: "B1", name: INTERNAL_LIST_NAME, closed: false, pos: 99 });
}

function mockEmptyCardsThenCreateStatus() {
  mockAgent
    .get(ORIGIN)
    .intercept({ method: "GET", path: (p) => p.startsWith("/1/lists/L99/cards") })
    .reply(200, []);
  mockAgent
    .get(ORIGIN)
    .intercept({
      method: "POST",
      path: (p) => p.startsWith("/1/cards") && p.includes("Status"),
    })
    .reply(200, {
      id: "C-status",
      name: STATUS_CARD_NAME,
      desc: "{}",
      idList: "L99",
      idBoard: "B1",
      idLabels: [],
      idMembers: [],
      pos: 1,
      closed: false,
      url: "u",
      shortUrl: "u",
    });
}

describe("runInit (happy path on a clean board)", () => {
  test("creates auth.json + 8 labels + internal list + status card; returns summary", async () => {
    mockGetBoard();
    mockEmptyLabelsThenCreate8();
    mockEmptyListsThenCreateInternal();
    mockEmptyCardsThenCreateStatus();

    const result = await runInit({
      apiKey: "k",
      token: "t",
      boardId: "B1",
      authPath,
      client: client(),
    });

    expect(result.authPath).toBe(authPath);
    expect(result.board.id).toBe("B1");
    expect(result.labelsCreated).toBe(8);
    expect(result.labelsExisting).toBe(0);
    expect(result.internalListCreated).toBe(true);
    expect(result.internalListId).toBe("L99");
    expect(result.statusCardCreated).toBe(true);
    expect(result.statusCardId).toBe("C-status");

    // Auth file written with the right content
    const written = JSON.parse(await readFile(authPath, "utf8"));
    expect(written.apiKey).toBe("k");
    expect(written.token).toBe("t");
    expect(written.boardId).toBe("B1");
    expect(written.internal_lists).toEqual([INTERNAL_LIST_NAME]);
  });
});

describe("runInit (idempotency on a partially-set-up board)", () => {
  test("returns 0 labels created when all 8 already exist", async () => {
    mockGetBoard();

    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/labels") })
      .reply(
        200,
        WORKFLOW_LABELS.map((d, i) => ({
          id: `existing-${i}`,
          idBoard: "B1",
          name: d.name,
          color: d.color,
        })),
      );

    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/boards/B1/lists") })
      .reply(200, [
        { id: "L99", idBoard: "B1", name: INTERNAL_LIST_NAME, closed: false, pos: 99 },
      ]);

    mockAgent
      .get(ORIGIN)
      .intercept({ method: "GET", path: (p) => p.startsWith("/1/lists/L99/cards") })
      .reply(200, [
        {
          id: "C-status",
          name: STATUS_CARD_NAME,
          desc: "{}",
          idList: "L99",
          idBoard: "B1",
          idLabels: [],
          idMembers: [],
          pos: 1,
          closed: false,
          url: "u",
          shortUrl: "u",
        },
      ]);

    const result = await runInit({
      apiKey: "k",
      token: "t",
      boardId: "B1",
      authPath,
      force: true, // because auth file may exist from prior test runs
      client: client(),
    });

    expect(result.labelsCreated).toBe(0);
    expect(result.labelsExisting).toBe(8);
    expect(result.internalListCreated).toBe(false);
    expect(result.statusCardCreated).toBe(false);
  });
});

describe("runInit (auth file safety)", () => {
  test("refuses to overwrite existing auth file without --force", async () => {
    await writeFile(authPath, JSON.stringify({ apiKey: "old", token: "old", boardId: "X" }));

    const promise = runInit({
      apiKey: "k",
      token: "t",
      boardId: "B1",
      authPath,
      client: client(),
    });

    await expect(promise).rejects.toThrow(AuthError);
    await expect(promise).rejects.toThrow(/already exists/);
    await expect(promise).rejects.toThrow(/--force/);
  });

  test("--force overwrites existing auth file", async () => {
    await writeFile(authPath, JSON.stringify({ apiKey: "old", token: "old", boardId: "X" }));

    mockGetBoard();
    mockEmptyLabelsThenCreate8();
    mockEmptyListsThenCreateInternal();
    mockEmptyCardsThenCreateStatus();

    const result = await runInit({
      apiKey: "k",
      token: "t",
      boardId: "B1",
      authPath,
      force: true,
      client: client(),
    });

    expect(result.board.id).toBe("B1");
    const written = JSON.parse(await readFile(authPath, "utf8"));
    expect(written.apiKey).toBe("k"); // overwritten
  });
});
