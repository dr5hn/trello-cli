import { describe, test, expect, beforeEach } from "vitest";
import { buildProgram } from "../../src/cli.js";
import type { Command } from "commander";

interface Capture {
  stdout: string[];
  stderr: string[];
}

function captured(): { program: Command; cap: Capture } {
  const cap: Capture = { stdout: [], stderr: [] };
  const program = buildProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (s) => cap.stdout.push(s),
      writeErr: (s) => cap.stderr.push(s),
    });
  return { program, cap };
}

async function run(argv: string[]): Promise<{ cap: Capture; err: unknown }> {
  const { program, cap } = captured();
  let err: unknown = undefined;
  try {
    await program.parseAsync(["node", "trello-cli", ...argv]);
  } catch (e) {
    err = e;
  }
  return { cap, err };
}

describe("CLI shell", () => {
  test("--version prints 0.1.0", async () => {
    const { cap } = await run(["--version"]);
    const out = cap.stdout.join("");
    expect(out).toContain("0.1.0");
  });

  test("--help lists all top-level subcommands", async () => {
    const { cap } = await run(["--help"]);
    const out = cap.stdout.join("");
    expect(out).toContain("init");
    expect(out).toContain("cards");
    expect(out).toContain("labels");
    expect(out).toContain("board");
    expect(out).toContain("watch");
  });

  test("--help lists global --format and --verbose options", async () => {
    const { cap } = await run(["--help"]);
    const out = cap.stdout.join("");
    expect(out).toContain("--format");
    expect(out).toContain("json");
    expect(out).toContain("table");
    expect(out).toContain("--verbose");
  });

  test("`cards --help` lists card subcommands", async () => {
    const { cap } = await run(["cards", "--help"]);
    const out = cap.stdout.join("");
    expect(out).toContain("list");
    expect(out).toContain("get");
    expect(out).toContain("create");
    expect(out).toContain("update");
    expect(out).toContain("comment");
    expect(out).toContain("claim");
    expect(out).toContain("release");
  });

  test("`cards list --help` shows --label, --not-label, --tier options", async () => {
    const { cap } = await run(["cards", "list", "--help"]);
    const out = cap.stdout.join("");
    expect(out).toContain("--label");
    expect(out).toContain("--not-label");
    expect(out).toContain("--tier");
    expect(out).toContain("--stale-days");
  });

  test("`cards release` requires --status", async () => {
    const { err } = await run(["cards", "release", "abc"]);
    expect(err).toBeDefined();
  });

  test("`cards release --status invalid-value` is rejected by validator", async () => {
    const { err } = await run(["cards", "release", "abc", "--status", "garbage"]);
    expect(err).toBeDefined();
  });

  test("unknown subcommand exits with non-zero (or throws when exitOverride active)", async () => {
    const { err } = await run(["nonsense"]);
    expect(err).toBeDefined();
  });

  test("--format must be one of json | table", async () => {
    const { err } = await run(["--format", "yaml", "init"]);
    expect(err).toBeDefined();
  });
});
