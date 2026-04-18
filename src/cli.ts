#!/usr/bin/env node
import { Command, Option } from "commander";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { initCommand } from "./commands/init.js";
import { labelsEnsureCommand } from "./commands/labels-cmd.js";
import { listCommand } from "./commands/cards/list.js";
import { getCommand } from "./commands/cards/get.js";
import { createCommand } from "./commands/cards/create.js";
import { updateCommand } from "./commands/cards/update.js";
import { commentCommand } from "./commands/cards/comment.js";
import { claimCommand } from "./commands/cards/claim.js";
import { releaseCommand, type ReleaseStatus } from "./commands/cards/release.js";
import { summaryCommand } from "./commands/board.js";
import { watchCommand } from "./commands/watch.js";

const VERSION = "0.1.0";

/**
 * Build the CLI program. Subcommands are registered as stubs in this task;
 * Tasks 14–21 replace each stub action with the real implementation.
 *
 * Returning the program (rather than parsing inline) makes the CLI testable
 * without spawning a process — tests build the program, call parseAsync()
 * with controlled argv, and assert on captured output.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name("trello-cli")
    .description("Generic Trello CLI used by Webby Wonder Autopilot.")
    .version(VERSION, "-V, --version", "print version and exit")
    .addOption(
      new Option("-f, --format <mode>", "output format")
        .choices(["json", "table"])
        .default("json"),
    )
    .addOption(new Option("-v, --verbose", "verbose logging to stderr").default(false))
    .showHelpAfterError(true)
    .configureHelp({ sortSubcommands: true });

  registerInit(program);
  registerCards(program);
  registerLabels(program);
  registerBoard(program);
  registerWatch(program);

  return program;
}

function registerInit(program: Command): void {
  program
    .command("init")
    .description("One-time setup: API key, token, board ID, status card.")
    .option("--board-id <id>", "Trello board ID (otherwise prompts interactively)")
    .option("--force", "overwrite an existing auth file", false)
    .action(async (cmdOpts: { boardId?: string; force?: boolean }) => {
      await initCommand({
        ...(cmdOpts.boardId !== undefined ? { boardId: cmdOpts.boardId } : {}),
        force: cmdOpts.force ?? false,
      });
    });
}

function registerCards(program: Command): void {
  const cards = program.command("cards").description("Card operations.");

  cards
    .command("list")
    .description("List cards filtered by label / list / repo / mine / stale-days.")
    .option("--label <name...>", "include only cards with ALL listed labels (repeatable)")
    .option("--not-label <name...>", "exclude cards bearing ANY of these labels (repeatable)")
    .option("--list <name>", "restrict to one list")
    .option("--repo <name...>", "filter by `repo` custom field value (repeatable)")
    .option("--tier <tier>", "(reserved — not yet implemented; see --repo)")
    .option("--mine", "restrict to cards assigned to me", false)
    .option("--stale-days <n>", "only cards untouched for N+ days", parsePositiveInt)
    .action(async (cmdOpts: ListLikeOpts, cmd: Command) => {
      await listCommand({
        format: globalFormat(cmd),
        ...(cmdOpts.label !== undefined ? { label: cmdOpts.label } : {}),
        ...(cmdOpts.notLabel !== undefined ? { notLabel: cmdOpts.notLabel } : {}),
        ...(cmdOpts.list !== undefined ? { list: cmdOpts.list } : {}),
        ...(cmdOpts.repo !== undefined ? { repo: cmdOpts.repo } : {}),
        ...(cmdOpts.tier !== undefined ? { tier: cmdOpts.tier } : {}),
        mine: cmdOpts.mine ?? false,
        ...(cmdOpts.staleDays !== undefined ? { staleDays: cmdOpts.staleDays } : {}),
      });
    });

  cards
    .command("get <cardId>")
    .description("Fetch full details of a card.")
    .action(async (cardId: string, _opts, cmd: Command) => {
      await getCommand({ cardId, format: globalFormat(cmd) });
    });

  cards
    .command("create")
    .description("Create a new card.")
    .requiredOption("--title <text>", "card title")
    .option("--list <name>", "destination list (defaults to first open list)")
    .option("--label <name...>", "labels to attach (repeatable)")
    .option("--field <kv...>", "custom field as key=value (repeatable)")
    .option("--description <text>", "card description")
    .action(async (cmdOpts: CreateLikeOpts, cmd: Command) => {
      await createCommand({
        title: cmdOpts.title,
        format: globalFormat(cmd),
        ...(cmdOpts.list !== undefined ? { list: cmdOpts.list } : {}),
        ...(cmdOpts.label !== undefined ? { label: cmdOpts.label } : {}),
        ...(cmdOpts.field !== undefined ? { field: cmdOpts.field } : {}),
        ...(cmdOpts.description !== undefined ? { description: cmdOpts.description } : {}),
      });
    });

  cards
    .command("update <cardId>")
    .description("Mutate labels, list, or custom fields on a card.")
    .option("--add-label <name...>", "labels to add (repeatable)")
    .option("--remove-label <name...>", "labels to remove (repeatable)")
    .option("--list <name>", "move to this list")
    .option("--field <kv...>", "custom field as key=value (repeatable)")
    .action(async (cardId: string, cmdOpts: UpdateLikeOpts, cmd: Command) => {
      await updateCommand({
        cardId,
        format: globalFormat(cmd),
        ...(cmdOpts.addLabel !== undefined ? { addLabel: cmdOpts.addLabel } : {}),
        ...(cmdOpts.removeLabel !== undefined ? { removeLabel: cmdOpts.removeLabel } : {}),
        ...(cmdOpts.list !== undefined ? { list: cmdOpts.list } : {}),
        ...(cmdOpts.field !== undefined ? { field: cmdOpts.field } : {}),
      });
    });

  cards
    .command("comment <cardId>")
    .description("Add a comment to a card.")
    .option("--body <text>", "comment text (or use --from-stdin)")
    .option("--from-stdin", "read comment text from stdin", false)
    .action(async (cardId: string, cmdOpts: CommentLikeOpts, cmd: Command) => {
      await commentCommand({
        cardId,
        format: globalFormat(cmd),
        ...(cmdOpts.body !== undefined ? { body: cmdOpts.body } : {}),
        fromStdin: cmdOpts.fromStdin ?? false,
      });
    });

  cards
    .command("claim <cardId>")
    .description("Best-effort claim (4-step protocol; for worker use).")
    .option("--worker-id <id>", "unique worker identifier (default: <hostname>:<pid>:<iso>)")
    .action(async (cardId: string, cmdOpts: { workerId?: string }, cmd: Command) => {
      await claimCommand({
        cardId,
        format: globalFormat(cmd),
        ...(cmdOpts.workerId !== undefined ? { workerId: cmdOpts.workerId } : {}),
      });
    });

  cards
    .command("release <cardId>")
    .description("Release a claimed card with a status transition.")
    .requiredOption(
      "--status <status>",
      "transition target",
      (v): ReleaseStatus => {
        const allowed: ReleaseStatus[] = ["pr-opened", "stuck", "done"];
        if (!(allowed as string[]).includes(v)) {
          throw new Error(`--status must be one of: ${allowed.join(", ")}`);
        }
        return v as ReleaseStatus;
      },
    )
    .option("--pr-url <url>", "PR URL (when status=pr-opened)")
    .option("--reason <text>", "reason text (when status=stuck)")
    .action(async (cardId: string, cmdOpts: ReleaseLikeOpts, cmd: Command) => {
      await releaseCommand({
        cardId,
        status: cmdOpts.status,
        format: globalFormat(cmd),
        ...(cmdOpts.prUrl !== undefined ? { prUrl: cmdOpts.prUrl } : {}),
        ...(cmdOpts.reason !== undefined ? { reason: cmdOpts.reason } : {}),
      });
    });
}

interface ListLikeOpts {
  label?: string[];
  notLabel?: string[];
  list?: string;
  repo?: string[];
  tier?: string;
  mine?: boolean;
  staleDays?: number;
}
interface CreateLikeOpts {
  title: string;
  list?: string;
  label?: string[];
  field?: string[];
  description?: string;
}
interface UpdateLikeOpts {
  addLabel?: string[];
  removeLabel?: string[];
  list?: string;
  field?: string[];
}
interface CommentLikeOpts {
  body?: string;
  fromStdin?: boolean;
}
interface ReleaseLikeOpts {
  status: ReleaseStatus;
  prUrl?: string;
  reason?: string;
}

function globalFormat(cmd: Command): "json" | "table" {
  // Walk up to root to pick up the global --format option.
  let cursor: Command | null = cmd;
  while (cursor) {
    const opts = cursor.opts();
    if (typeof opts["format"] === "string") return opts["format"] as "json" | "table";
    cursor = cursor.parent;
  }
  return "json";
}

function registerLabels(program: Command): void {
  const labels = program.command("labels").description("Label operations.");
  labels
    .command("ensure")
    .description("Idempotently create the 8 ww-* workflow labels on the board.")
    .action(async (_cmdOpts, cmd: Command) => {
      const globals = cmd.parent?.parent?.opts() as { format?: "json" | "table" } | undefined;
      await labelsEnsureCommand({ format: globals?.format ?? "json" });
    });
}

function registerBoard(program: Command): void {
  const board = program.command("board").description("Board-level operations.");
  board
    .command("summary")
    .description("Counts by list × label × tier (excludes internal_lists from auth.json).")
    .action(async (_cmdOpts, cmd: Command) => {
      await summaryCommand({ format: globalFormat(cmd) });
    });
}

function registerWatch(program: Command): void {
  program
    .command("watch")
    .description("Long-poll for new cards matching a filter; emit NDJSON events.")
    .option("--label <name>", "label to watch for")
    .option("--interval <duration>", "poll interval (e.g. 15m, 30s)", "15m")
    .action(async (cmdOpts: { label?: string; interval?: string }) => {
      await watchCommand({
        ...(cmdOpts.label !== undefined ? { label: cmdOpts.label } : {}),
        ...(cmdOpts.interval !== undefined ? { interval: cmdOpts.interval } : {}),
      });
    });
}

function stubAction(commandName: string, taskRef: string): () => never {
  return () => {
    process.stderr.write(
      `${pc.yellow("trello-cli:")} \`${commandName}\` is not yet implemented (${taskRef}).\n`,
    );
    process.exit(2);
  };
}

function parsePositiveInt(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`expected positive integer, got "${raw}"`);
  }
  return n;
}

/**
 * Common error handler for the top-level CLI. Maps known error types to
 * friendly stderr messages + non-zero exit codes; falls back to throw for
 * unexpected errors so the user sees the stack.
 */
export function handleError(err: unknown): never {
  // Commander throws CommanderError on --help/--version/parse errors;
  // it sets exitCode itself, so we just re-throw and let it propagate.
  if (err instanceof Error && err.constructor.name === "CommanderError") {
    process.exit((err as { exitCode?: number }).exitCode ?? 1);
  }
  if (err instanceof Error) {
    process.stderr.write(`${pc.red("error:")} ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(`${pc.red("error:")} ${String(err)}\n`);
  process.exit(1);
}

// Auto-run when executed directly (ESM-safe entrypoint check).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildProgram()
    .parseAsync(process.argv)
    .catch(handleError);
}
