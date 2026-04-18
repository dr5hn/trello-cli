import { describe, test, expect } from "vitest";
import { formatJson, formatTable, format } from "../../src/lib/output.js";

describe("formatJson", () => {
  test("pretty-prints with 2-space indent by default", () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  test("handles arrays", () => {
    expect(formatJson([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
  });

  test("handles null and undefined", () => {
    expect(formatJson(null)).toBe("null");
    expect(formatJson(undefined)).toBe(undefined);
  });
});

describe("formatTable", () => {
  test("empty rows → '(no rows)'", () => {
    expect(formatTable([])).toBe("(no rows)");
  });

  test("infers columns from first row", () => {
    const out = formatTable([{ id: "abc", name: "Card 1" }]);
    expect(out).toContain("id");
    expect(out).toContain("name");
    expect(out).toContain("abc");
    expect(out).toContain("Card 1");
  });

  test("respects explicit column order", () => {
    const out = formatTable(
      [{ id: "abc", name: "Card 1" }],
      { columns: ["name", "id"] },
    );
    const headerLine = out.split("\n")[0]!;
    expect(headerLine.indexOf("name")).toBeLessThan(headerLine.indexOf("id"));
  });

  test("hides columns not listed in opts.columns", () => {
    const out = formatTable(
      [{ id: "abc", name: "Card 1", secret: "x" }],
      { columns: ["id", "name"] },
    );
    expect(out).not.toContain("secret");
  });

  test("truncates values longer than maxColWidth with ellipsis", () => {
    const out = formatTable(
      [{ name: "this is a very long card title that should be truncated" }],
      { maxColWidth: 20 },
    );
    expect(out).toContain("…");
    const lines = out.split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(50); // header padding + col + separator
    }
  });

  test("renders null/undefined cells as empty strings", () => {
    const out = formatTable([{ id: "x", name: null, idLabels: undefined }]);
    expect(out).toContain("x");
    expect(out).not.toContain("null");
    expect(out).not.toContain("undefined");
  });

  test("renders nested objects as compact JSON", () => {
    const out = formatTable([{ id: "x", labels: ["a", "b"] }]);
    expect(out).toContain('["a","b"]');
  });

  test("aligns columns by padding", () => {
    const out = formatTable([
      { id: "short", name: "x" },
      { id: "longer-id", name: "y" },
    ]);
    const lines = out.split("\n");
    // header + separator + 2 rows
    expect(lines).toHaveLength(4);
    // each line has the same length (modulo the trailing column which won't be padded)
    expect(lines[2]!.indexOf("x")).toBe(lines[3]!.indexOf("y"));
  });
});

describe("format dispatcher", () => {
  test("mode='json' delegates to formatJson", () => {
    expect(format({ a: 1 }, "json")).toBe('{\n  "a": 1\n}');
  });

  test("mode='table' with array of objects → table", () => {
    const out = format([{ id: "abc" }], "table");
    expect(out).toContain("abc");
    expect(out).toContain("---");
  });

  test("mode='table' with non-array → falls back to JSON", () => {
    expect(format({ a: 1 }, "table")).toBe('{\n  "a": 1\n}');
  });

  test("mode='table' with array of primitives → falls back to JSON", () => {
    expect(format([1, 2, 3], "table")).toBe("[\n  1,\n  2,\n  3\n]");
  });
});
