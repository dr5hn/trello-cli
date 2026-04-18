import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAuth, saveAuth, AuthError, defaultAuthPath } from "../../src/lib/auth.js";

const validAuth = {
  apiKey: "0123456789abcdef0123456789abcdef",
  token: "ATTAfeedbabe000000000000000000000000000000000000000000000000000000000000",
  boardId: "abc123def456",
  slackChannelId: "C01234ABC",
  slackPulseChannelId: "C56789DEF",
  slackOwnerId: "U01234XYZ",
  internal_lists: ["📊 Internal"],
};

describe("auth library", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trello-cli-auth-"));
    path = join(dir, "auth.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.TRELLO_CLI_AUTH_PATH;
    delete process.env.XDG_CONFIG_HOME;
  });

  test("save then load round-trips the full payload", async () => {
    await saveAuth(validAuth, path);
    const loaded = await loadAuth(path);
    expect(loaded).toEqual(validAuth);
  });

  test("save sets file mode to 0o600", async () => {
    await saveAuth(validAuth, path);
    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);
  });

  test("save uses atomic write — no .tmp file remains after success", async () => {
    await saveAuth(validAuth, path);
    const entries = await readdir(dir);
    expect(entries.filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(entries).toContain("auth.json");
  });

  test("save creates parent directory recursively if missing", async () => {
    const nestedPath = join(dir, "deeply", "nested", "auth.json");
    await saveAuth(validAuth, nestedPath);
    const loaded = await loadAuth(nestedPath);
    expect(loaded).toEqual(validAuth);
  });

  test("save preserves 0o600 even when overwriting an existing file with different mode", async () => {
    await writeFile(path, "{}", { mode: 0o644 });
    await saveAuth(validAuth, path);
    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);
  });

  test("load throws AuthError when file missing, with init hint", async () => {
    await expect(loadAuth(path)).rejects.toThrow(AuthError);
    await expect(loadAuth(path)).rejects.toThrow(/not found/i);
    await expect(loadAuth(path)).rejects.toThrow(/trello-cli init/i);
  });

  test("load throws AuthError on malformed JSON", async () => {
    await writeFile(path, "{not-json}");
    await expect(loadAuth(path)).rejects.toThrow(AuthError);
    await expect(loadAuth(path)).rejects.toThrow(/parse/i);
  });

  test("load throws AuthError on schema violation, naming the offending field", async () => {
    await writeFile(path, JSON.stringify({ apiKey: "" }));
    const promise = loadAuth(path);
    await expect(promise).rejects.toThrow(AuthError);
    await expect(promise).rejects.toThrow(/apiKey|token|boardId/);
  });

  test("internal_lists defaults to ['📊 Internal'] when omitted from file", async () => {
    const minimal = {
      apiKey: validAuth.apiKey,
      token: validAuth.token,
      boardId: validAuth.boardId,
    };
    await writeFile(path, JSON.stringify(minimal));
    const loaded = await loadAuth(path);
    expect(loaded.internal_lists).toEqual(["📊 Internal"]);
  });

  test("optional Slack fields can be omitted", async () => {
    const minimal = {
      apiKey: validAuth.apiKey,
      token: validAuth.token,
      boardId: validAuth.boardId,
    };
    await writeFile(path, JSON.stringify(minimal));
    const loaded = await loadAuth(path);
    expect(loaded.apiKey).toBe(validAuth.apiKey);
    expect(loaded.slackChannelId).toBeUndefined();
  });

  test("defaultAuthPath honours XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    expect(defaultAuthPath()).toBe("/tmp/xdg-test/trello-cli/auth.json");
  });

  test("defaultAuthPath honours TRELLO_CLI_AUTH_PATH override", () => {
    process.env.TRELLO_CLI_AUTH_PATH = "/elsewhere/auth.json";
    expect(defaultAuthPath()).toBe("/elsewhere/auth.json");
  });
});
