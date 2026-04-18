/**
 * Output formatters: JSON (default, scriptable) and table (for humans).
 *
 * Both are pure functions returning strings — no side effects, no console writes.
 * Callers (commands) decide where the formatted output goes (stdout, file, pipe).
 */

export type OutputMode = "json" | "table";

export interface TableOptions {
  columns?: string[];
  maxColWidth?: number;
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatTable(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: TableOptions = {},
): string {
  if (rows.length === 0) return "(no rows)";

  const maxColWidth = opts.maxColWidth ?? 50;
  const columns =
    opts.columns ??
    Array.from(new Set(rows.flatMap((r) => Object.keys(r))));

  if (columns.length === 0) return "(no columns)";

  const renderCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const truncate = (s: string, max: number): string =>
    s.length > max ? `${s.slice(0, max - 1)}…` : s;

  const widths = new Map<string, number>();
  for (const col of columns) {
    widths.set(col, col.length);
  }
  for (const row of rows) {
    for (const col of columns) {
      const cell = truncate(renderCell(row[col]), maxColWidth);
      const current = widths.get(col) ?? 0;
      if (cell.length > current) widths.set(col, cell.length);
    }
  }

  const sep = "  ";
  const widthOf = (col: string): number => widths.get(col) ?? 0;

  const header = columns.map((c) => c.padEnd(widthOf(c))).join(sep);
  const separator = columns.map((c) => "-".repeat(widthOf(c))).join(sep);
  const body = rows.map((row) =>
    columns
      .map((c) => truncate(renderCell(row[c]), maxColWidth).padEnd(widthOf(c)))
      .join(sep),
  );

  return [header, separator, ...body].join("\n");
}

export function format(
  data: unknown,
  mode: OutputMode,
  opts: TableOptions = {},
): string {
  if (mode === "json") return formatJson(data);
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((d) => typeof d === "object" && d !== null && !Array.isArray(d))
  ) {
    return formatTable(data as ReadonlyArray<Record<string, unknown>>, opts);
  }
  return formatJson(data);
}
