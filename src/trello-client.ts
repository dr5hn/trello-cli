/**
 * Thin wrapper around the Trello REST API v1.
 *
 * Auth: API key + token via query parameters (per Trello convention).
 * Rate limiting: every request waits for a token from the bucket (default
 * 25 req/s steady, burst 100). On HTTP 429 the request retries with exponential
 * backoff respecting Retry-After.
 *
 * Reference: https://developer.atlassian.com/cloud/trello/rest/
 */

import { fetch, type RequestInit } from "undici";
import {
  TokenBucket,
  RateLimitError,
  nextBackoffMs,
} from "./lib/rate-limiter.js";
import { TrelloApiError } from "./lib/errors.js";

const DEFAULT_BASE_URL = "https://api.trello.com/1";
const DEFAULT_MAX_RETRIES = 5;

export interface TrelloClientOptions {
  apiKey: string;
  token: string;
  baseUrl?: string;
  bucket?: TokenBucket;
  maxRetries?: number;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export class TrelloClient {
  readonly apiKey: string;
  readonly token: string;
  readonly baseUrl: string;
  readonly bucket: TokenBucket;
  readonly maxRetries: number;

  constructor(opts: TrelloClientOptions) {
    if (!opts.apiKey) throw new Error("apiKey is required");
    if (!opts.token) throw new Error("token is required");
    this.apiKey = opts.apiKey;
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.bucket =
      opts.bucket ?? new TokenBucket({ capacity: 100, refillPerSecond: 25 });
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** Low-level request helper — used by every typed method below. */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const init: RequestInit = {
      method,
      headers: { "content-type": "application/json", accept: "application/json" },
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.bucket.take(1);

      const response = await fetch(url, init);

      if (response.status === 429) {
        if (attempt >= this.maxRetries) {
          throw new RateLimitError(
            `Trello rate limit exceeded after ${attempt + 1} attempts`,
            { status: 429, retryAfterSec: parseRetryAfter(response.headers) },
          );
        }
        const retryAfterSec = parseRetryAfter(response.headers);
        await sleep(nextBackoffMs(attempt, retryAfterSec));
        continue;
      }

      if (response.status >= 500 && attempt < this.maxRetries) {
        await sleep(nextBackoffMs(attempt));
        continue;
      }

      if (!response.ok) {
        const body = await safeReadBody(response);
        throw new TrelloApiError(
          `Trello API ${method} ${path} returned ${response.status}: ${truncate(stringify(body), 200)}`,
          { status: response.status, method, url, body },
        );
      }

      // 204 No Content
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
    /* istanbul ignore next: exhausted retries handled above */
    throw new RateLimitError("max retries exhausted (unreachable)", { status: 429 });
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path}`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("token", this.token);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  // ─────────────────────────────────────────────────────────────────
  // Cards
  // ─────────────────────────────────────────────────────────────────

  /** Fetch all cards on a board (paginated server-side; Trello returns all). */
  cardsOnBoard(boardId: string, query?: Record<string, string>): Promise<TrelloCard[]> {
    return this.request<TrelloCard[]>("GET", `/boards/${boardId}/cards`, { query });
  }

  /** Cards in one list. */
  cardsInList(listId: string, query?: Record<string, string>): Promise<TrelloCard[]> {
    return this.request<TrelloCard[]>("GET", `/lists/${listId}/cards`, { query });
  }

  getCard(cardId: string, query?: Record<string, string>): Promise<TrelloCard> {
    return this.request<TrelloCard>("GET", `/cards/${cardId}`, { query });
  }

  createCard(params: {
    idList: string;
    name: string;
    desc?: string;
    idLabels?: string[];
    pos?: "top" | "bottom" | number;
  }): Promise<TrelloCard> {
    return this.request<TrelloCard>("POST", `/cards`, { query: stringifyQuery(params) });
  }

  updateCard(
    cardId: string,
    params: {
      name?: string;
      desc?: string;
      closed?: boolean;
      idList?: string;
      pos?: "top" | "bottom" | number;
    },
  ): Promise<TrelloCard> {
    return this.request<TrelloCard>("PUT", `/cards/${cardId}`, {
      query: stringifyQuery(params),
    });
  }

  addLabelToCard(cardId: string, labelId: string): Promise<unknown> {
    return this.request("POST", `/cards/${cardId}/idLabels`, { query: { value: labelId } });
  }

  removeLabelFromCard(cardId: string, labelId: string): Promise<unknown> {
    return this.request("DELETE", `/cards/${cardId}/idLabels/${labelId}`);
  }

  addCommentToCard(cardId: string, text: string): Promise<unknown> {
    return this.request("POST", `/cards/${cardId}/actions/comments`, { query: { text } });
  }

  // ─────────────────────────────────────────────────────────────────
  // Custom fields (used by claim/release for `claimed-at`, `repo`, etc.)
  // ─────────────────────────────────────────────────────────────────

  customFieldsOnBoard(boardId: string): Promise<TrelloCustomField[]> {
    return this.request<TrelloCustomField[]>("GET", `/boards/${boardId}/customFields`);
  }

  /**
   * Set a text-type custom field's value on a card.
   * For other field types, callers must format `value.text` / `value.number` /
   * `value.date` / `value.checked` per the Trello API spec.
   */
  setCustomFieldText(
    cardId: string,
    customFieldId: string,
    text: string,
  ): Promise<unknown> {
    return this.request("PUT", `/cards/${cardId}/customField/${customFieldId}/item`, {
      body: { value: { text } },
    });
  }

  clearCustomField(cardId: string, customFieldId: string): Promise<unknown> {
    return this.request("PUT", `/cards/${cardId}/customField/${customFieldId}/item`, {
      body: { value: {} },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Labels
  // ─────────────────────────────────────────────────────────────────

  labelsOnBoard(boardId: string): Promise<TrelloLabel[]> {
    return this.request<TrelloLabel[]>("GET", `/boards/${boardId}/labels`, {
      query: { limit: 1000 },
    });
  }

  createLabel(params: {
    idBoard: string;
    name: string;
    color: TrelloLabelColor | null;
  }): Promise<TrelloLabel> {
    return this.request<TrelloLabel>("POST", `/labels`, {
      query: {
        name: params.name,
        color: params.color ?? "",
        idBoard: params.idBoard,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Lists
  // ─────────────────────────────────────────────────────────────────

  listsOnBoard(boardId: string, filter: "open" | "closed" | "all" = "open"): Promise<TrelloList[]> {
    return this.request<TrelloList[]>("GET", `/boards/${boardId}/lists`, {
      query: { filter },
    });
  }

  createList(params: { idBoard: string; name: string; pos?: "top" | "bottom" | number }): Promise<TrelloList> {
    return this.request<TrelloList>("POST", `/lists`, { query: stringifyQuery(params) });
  }

  // ─────────────────────────────────────────────────────────────────
  // Boards / Members
  // ─────────────────────────────────────────────────────────────────

  getBoard(boardId: string, query?: Record<string, string>): Promise<TrelloBoard> {
    return this.request<TrelloBoard>("GET", `/boards/${boardId}`, { query });
  }

  myBoards(): Promise<TrelloBoard[]> {
    return this.request<TrelloBoard[]>("GET", `/members/me/boards`, {
      query: { fields: "name,id,closed", filter: "open" },
    });
  }

  membersOnBoard(boardId: string): Promise<TrelloMember[]> {
    return this.request<TrelloMember[]>("GET", `/boards/${boardId}/members`);
  }
}

// ─────────────────────────────────────────────────────────────────
// Types — minimal shapes; Trello returns many more fields than these.
// Add to these as new code paths need fields.
// ─────────────────────────────────────────────────────────────────

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idBoard: string;
  idLabels: string[];
  idMembers: string[];
  pos: number;
  closed: boolean;
  url: string;
  shortUrl: string;
  dateLastActivity?: string;
  /** Present only when the request includes `?customFieldItems=true`. */
  customFieldItems?: TrelloCustomFieldItem[];
  /** Present only when the request includes `?labels=true`. */
  labels?: TrelloLabel[];
}

export interface TrelloCustomFieldItem {
  id: string;
  idCustomField: string;
  idModel: string;
  modelType: string;
  /**
   * Trello stores a value with one of the type-specific keys present.
   * For our `claimed-at` text field, only `text` matters.
   */
  value: { text?: string; number?: string; date?: string; checked?: string };
}

export interface TrelloLabel {
  id: string;
  idBoard: string;
  name: string;
  color: TrelloLabelColor | null;
}

export type TrelloLabelColor =
  | "yellow"
  | "purple"
  | "blue"
  | "red"
  | "green"
  | "orange"
  | "black"
  | "sky"
  | "pink"
  | "lime"
  | "yellow_dark"
  | "purple_dark"
  | "blue_dark"
  | "red_dark"
  | "green_dark"
  | "orange_dark"
  | "black_dark"
  | "sky_dark"
  | "pink_dark"
  | "lime_dark";

export interface TrelloList {
  id: string;
  idBoard: string;
  name: string;
  closed: boolean;
  pos: number;
}

export interface TrelloBoard {
  id: string;
  name: string;
  closed: boolean;
  url: string;
  shortUrl: string;
}

export interface TrelloMember {
  id: string;
  username: string;
  fullName: string;
}

export interface TrelloCustomField {
  id: string;
  idModel: string;
  modelType: string;
  name: string;
  type: "text" | "number" | "date" | "list" | "checkbox";
  pos: number;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const ct = response.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return await response.json();
    return await response.text();
  } catch {
    return undefined;
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stringifyQuery(
  params: Record<string, string | number | boolean | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
