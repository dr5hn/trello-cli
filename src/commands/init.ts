/**
 * `trello-cli init` — one-time setup.
 *
 * Two layers:
 *   - `runInit()`: pure business logic, takes credentials and a board ID,
 *     persists auth, creates labels + internal list + status card. Testable.
 *   - `initCommand()`: the CLI handler that prompts for credentials interactively
 *     (using @inquirer/prompts), then delegates to runInit.
 */

import { stat } from "node:fs/promises";
import { confirm, input, password, select } from "@inquirer/prompts";
import pc from "picocolors";
import {
  loadAuth,
  saveAuth,
  defaultAuthPath,
  AuthError,
  type Auth,
} from "../lib/auth.js";
import { TrelloClient, type TrelloBoard } from "../trello-client.js";
import { ensureLabels } from "../lib/labels.js";
import {
  ensureInternalList,
  ensureStatusCard,
  INTERNAL_LIST_NAME,
  STATUS_CARD_NAME,
} from "../lib/board-setup.js";
import { TrelloApiError } from "../lib/errors.js";

export interface RunInitOptions {
  apiKey: string;
  token: string;
  boardId: string;
  authPath?: string;
  force?: boolean;
  /** Inject a pre-built client for testing. Otherwise built from apiKey+token. */
  client?: TrelloClient;
}

export interface RunInitResult {
  authPath: string;
  board: TrelloBoard;
  labelsCreated: number;
  labelsExisting: number;
  internalListCreated: boolean;
  internalListId: string;
  statusCardCreated: boolean;
  statusCardId: string;
}

/**
 * Pure init flow — order matters: validate before save so bad credentials
 * never persist; save before board setup so partial-setup runs are
 * recoverable by re-running with --force off.
 */
export async function runInit(opts: RunInitOptions): Promise<RunInitResult> {
  const authPath = opts.authPath ?? defaultAuthPath();

  if (!opts.force) {
    const existing = await checkExisting(authPath);
    if (existing) {
      throw new AuthError(
        `Auth file already exists at ${authPath}. Pass --force to overwrite.`,
      );
    }
  }

  const client =
    opts.client ?? new TrelloClient({ apiKey: opts.apiKey, token: opts.token });

  const board = await client.getBoard(opts.boardId, { fields: "id,name,closed,url,shortUrl" });

  const auth: Auth = {
    apiKey: opts.apiKey,
    token: opts.token,
    boardId: opts.boardId,
    internal_lists: [INTERNAL_LIST_NAME],
  };
  await saveAuth(auth, authPath);

  const labelsResult = await ensureLabels(client, opts.boardId);
  const listResult = await ensureInternalList(client, opts.boardId);
  const cardResult = await ensureStatusCard(client, listResult.resource.id);

  return {
    authPath,
    board,
    labelsCreated: labelsResult.created.length,
    labelsExisting: labelsResult.existing.length,
    internalListCreated: listResult.created,
    internalListId: listResult.resource.id,
    statusCardCreated: cardResult.created,
    statusCardId: cardResult.resource.id,
  };
}

async function checkExisting(authPath: string): Promise<boolean> {
  try {
    await stat(authPath);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Interactive command handler (CLI wrapper around runInit)
// ─────────────────────────────────────────────────────────────────

export interface InitCommandOptions {
  boardId?: string;
  force?: boolean;
  authPath?: string;
}

export async function initCommand(opts: InitCommandOptions): Promise<void> {
  const authPath = opts.authPath ?? defaultAuthPath();

  // Pre-flight: warn if auth exists and --force is not set, exit cleanly.
  if (!opts.force) {
    try {
      await loadAuth(authPath);
      process.stderr.write(
        `${pc.yellow("trello-cli:")} Auth file already exists at ${authPath}.\n` +
          `Pass ${pc.cyan("--force")} to overwrite.\n`,
      );
      process.exit(2);
    } catch (err) {
      // ENOENT is expected; rethrow other errors
      if (!(err instanceof AuthError) || !err.message.includes("not found")) {
        throw err;
      }
    }
  }

  process.stdout.write(
    `\n${pc.bold("trello-cli init")} — let's wire this up.\n\n` +
      `${pc.dim("Step 1.")} Open ${pc.cyan("https://trello.com/app-key")} in a browser to get your ${pc.bold("API key")}.\n`,
  );

  const apiKey = await input({
    message: "API key:",
    validate: (v) => (v.trim().length >= 16 ? true : "API key looks too short"),
  });

  const tokenUrl =
    `https://trello.com/1/authorize?expiration=never&name=trello-cli` +
    `&scope=read,write&response_type=token&key=${encodeURIComponent(apiKey.trim())}`;

  process.stdout.write(
    `\n${pc.dim("Step 2.")} Visit this URL to authorise the CLI and get your ${pc.bold("token")}:\n` +
      `  ${pc.cyan(tokenUrl)}\n`,
  );

  const token = await password({
    message: "Token:",
    mask: "*",
    validate: (v) => (v.trim().length >= 32 ? true : "Token looks too short"),
  });

  // Validate credentials by listing boards
  process.stdout.write(`\n${pc.dim("Validating credentials…")}\n`);
  const client = new TrelloClient({ apiKey: apiKey.trim(), token: token.trim() });

  let boards: TrelloBoard[];
  try {
    boards = await client.myBoards();
  } catch (err) {
    if (err instanceof TrelloApiError && (err.status === 401 || err.status === 403)) {
      throw new AuthError("Trello rejected the credentials — double-check key and token.");
    }
    throw err;
  }
  process.stdout.write(`${pc.green("✓")} ${boards.length} accessible board(s).\n\n`);

  let boardId: string;
  if (opts.boardId) {
    if (!boards.some((b) => b.id === opts.boardId)) {
      const valid = await confirm({
        message: `Board ${opts.boardId} is not in your accessible board list. Use it anyway?`,
        default: false,
      });
      if (!valid) process.exit(1);
    }
    boardId = opts.boardId;
  } else {
    boardId = await select({
      message: "Pick the board to use:",
      choices: boards.map((b) => ({ name: b.name, value: b.id, description: b.shortUrl })),
    });
  }

  process.stdout.write(`\n${pc.dim("Setting up board…")}\n`);
  const result = await runInit({
    apiKey: apiKey.trim(),
    token: token.trim(),
    boardId,
    authPath,
    force: opts.force ?? false,
    client,
  });

  process.stdout.write(
    `\n${pc.green("✓ Done.")}\n` +
      `  Auth saved to ${result.authPath}\n` +
      `  Board: ${result.board.name} (${result.board.id})\n` +
      `  Labels: ${result.labelsCreated} created, ${result.labelsExisting} already present\n` +
      `  ${INTERNAL_LIST_NAME} list: ${result.internalListCreated ? "created" : "already present"} (${result.internalListId})\n` +
      `  ${STATUS_CARD_NAME} card: ${result.statusCardCreated ? "created" : "already present"} (${result.statusCardId})\n`,
  );
}
