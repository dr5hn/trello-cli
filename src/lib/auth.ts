import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const AuthSchema = z.object({
  apiKey: z.string().min(1, "apiKey must be a non-empty string"),
  token: z.string().min(1, "token must be a non-empty string"),
  boardId: z.string().min(1, "boardId must be a non-empty string"),
  slackChannelId: z.string().optional(),
  slackPulseChannelId: z.string().optional(),
  slackOwnerId: z.string().optional(),
  internal_lists: z.array(z.string()).default(["📊 Internal"]),
});

export type Auth = z.infer<typeof AuthSchema>;
export type AuthInput = z.input<typeof AuthSchema>;

export class AuthError extends Error {
  override readonly name = "AuthError";
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
  }
}

export function defaultAuthPath(): string {
  const override = process.env["TRELLO_CLI_AUTH_PATH"];
  if (override && override.length > 0) {
    return override;
  }
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  const baseDir = xdgConfig && xdgConfig.length > 0 ? xdgConfig : join(homedir(), ".config");
  return join(baseDir, "trello-cli", "auth.json");
}

export async function loadAuth(path: string = defaultAuthPath()): Promise<Auth> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AuthError(
        `Auth file not found at ${path}. Run \`trello-cli init\` to set up.`,
        err,
      );
    }
    throw new AuthError(
      `Failed to read auth file at ${path}: ${(err as Error).message}`,
      err,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AuthError(
      `Failed to parse auth file at ${path}: ${(err as Error).message}`,
      err,
    );
  }

  const result = AuthSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new AuthError(
      `Auth file at ${path} failed schema validation: ${issues}`,
      result.error,
    );
  }

  return result.data;
}

export async function saveAuth(
  auth: AuthInput,
  path: string = defaultAuthPath(),
): Promise<void> {
  const validated = AuthSchema.parse(auth);

  await mkdir(dirname(path), { recursive: true });

  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(validated, null, 2), { mode: 0o600 });
  await rename(tmpPath, path);
  await chmod(path, 0o600);
}
