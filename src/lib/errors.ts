export interface TrelloApiErrorOptions {
  status: number;
  method: string;
  url: string;
  body?: unknown;
}

export class TrelloApiError extends Error {
  override readonly name = "TrelloApiError";
  readonly status: number;
  readonly method: string;
  readonly url: string;
  readonly body?: unknown;

  constructor(message: string, opts: TrelloApiErrorOptions) {
    super(message);
    this.status = opts.status;
    this.method = opts.method;
    this.url = opts.url;
    if (opts.body !== undefined) this.body = opts.body;
  }
}

export function isTrelloApiError(err: unknown): err is TrelloApiError {
  return err instanceof TrelloApiError;
}
