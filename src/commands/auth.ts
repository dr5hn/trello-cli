/**
 * `trello-cli auth` — write auth.json from credentials.
 *
 * Lighter-touch alternative to `init`: just persists API key + token + board
 * ID, without any board scaffolding (no labels ensure, no internal list, no
 * status card). Useful when you already have credentials and only want to
 * wire them in, or when re-authing on a new machine.
 *
 * Modes:
 *   - Interactive (default): prompts for each value via @inquirer/prompts
 *   - Scripted: pass --api-key, --token, --board-id flags
 *
 * Validation (default on; skip with --no-validate): calls getBoard() to
 * confirm credentials are accepted before writing the file. Failed
 * validation aborts WITHOUT touching auth.json.
 */

import { stat } from "node:fs/promises";
import { input, password } from "@inquirer/prompts";
import pc from "picocolors";
import { defaultAuthPath, saveAuth } from "../lib/auth.js";
import { TrelloClient } from "../trello-client.js";
import { TrelloApiError } from "../lib/errors.js";

export interface AuthCommandOptions {
  apiKey?: string;
  token?: string;
  boardId?: string;
  authPath?: string;
  force?: boolean;
  validate?: boolean;
}

export async function authCommand(opts: AuthCommandOptions): Promise<void> {
  const authPath = opts.authPath ?? defaultAuthPath();
  const shouldValidate = opts.validate !== false;

  // Refuse to clobber an existing auth file unless --force.
  if (!opts.force) {
    const exists = await fileExists(authPath);
    if (exists) {
      process.stderr.write(
        `${pc.yellow("trello-cli:")} Auth file already exists at ${authPath}.\n` +
          `Pass ${pc.cyan("--force")} to overwrite.\n`,
      );
      process.exit(2);
    }
  }

  const apiKey =
    opts.apiKey ??
    (await input({
      message: "API key:",
      validate: (v) => v.trim().length >= 16 || "API key looks too short",
    }));

  const token =
    opts.token ??
    (await password({
      message: "Token:",
      mask: "*",
      validate: (v) => v.trim().length >= 32 || "Token looks too short",
    }));

  const boardId =
    opts.boardId ??
    (await input({
      message: "Board ID (from trello.com/b/<BOARD_ID>/...):",
      validate: (v) => v.trim().length >= 8 || "Board ID looks too short",
    }));

  const trimmed = {
    apiKey: apiKey.trim(),
    token: token.trim(),
    boardId: boardId.trim(),
  };

  if (shouldValidate) {
    process.stdout.write(`\n${pc.dim("Validating credentials…")}\n`);
    const client = new TrelloClient({ apiKey: trimmed.apiKey, token: trimmed.token });
    try {
      const board = await client.getBoard(trimmed.boardId, { fields: "name,id" });
      process.stdout.write(`${pc.green("✓")} Connected to board: ${pc.bold(board.name)}\n`);
    } catch (err) {
      if (err instanceof TrelloApiError) {
        if (err.status === 401 || err.status === 403) {
          process.stderr.write(
            `${pc.red("✗")} Trello rejected the credentials. Check the key/token and try again.\n` +
              `(no auth file was written)\n`,
          );
          process.exit(1);
        }
        if (err.status === 404) {
          process.stderr.write(
            `${pc.red("✗")} Board ${trimmed.boardId} not found or not accessible to this token.\n` +
              `(no auth file was written)\n`,
          );
          process.exit(1);
        }
      }
      throw err;
    }
  }

  await saveAuth(
    {
      apiKey: trimmed.apiKey,
      token: trimmed.token,
      boardId: trimmed.boardId,
      internal_lists: ["📊 Internal"],
    },
    authPath,
  );

  process.stdout.write(`\n${pc.green("✓ Saved to")} ${authPath} ${pc.dim("(chmod 600)")}\n`);
  process.stdout.write(pc.dim("\nNext steps:\n"));
  process.stdout.write(pc.dim("  trello-cli labels ensure        # create the 8 workflow labels\n"));
  process.stdout.write(pc.dim("  trello-cli board summary        # smoke-test the connection\n"));
  process.stdout.write(
    pc.dim("  trello-cli init --force         # also creates 📊 Internal list + status card\n"),
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
