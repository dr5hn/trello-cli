/**
 * Shared command context: load auth and build a TrelloClient in one place.
 * Every command except `init` needs this preamble.
 */

import { loadAuth, type Auth } from "./auth.js";
import { TrelloClient } from "../trello-client.js";

export interface CommandContext {
  auth: Auth;
  client: TrelloClient;
}

export async function loadContext(authPath?: string): Promise<CommandContext> {
  const auth = await loadAuth(authPath);
  const client = new TrelloClient({ apiKey: auth.apiKey, token: auth.token });
  return { auth, client };
}
