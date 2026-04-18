import { describe, test, expect } from "vitest";
import {
  resolveLabelIds,
  resolveListId,
  resolveCustomField,
  ResolutionError,
} from "../../src/lib/resolve.js";
import type {
  TrelloLabel,
  TrelloList,
  TrelloCustomField,
} from "../../src/trello-client.js";

const labelMap = new Map<string, TrelloLabel>([
  ["ww-ready", { id: "L-ready", idBoard: "B1", name: "ww-ready", color: "green" }],
  ["intern-ok", { id: "L-intern", idBoard: "B1", name: "intern-ok", color: "sky" }],
]);

const listMap = new Map<string, TrelloList>([
  ["Todo", { id: "list-todo", idBoard: "B1", name: "Todo", closed: false, pos: 1 }],
  ["Done", { id: "list-done", idBoard: "B1", name: "Done", closed: false, pos: 5 }],
]);

const fieldMap = new Map<string, TrelloCustomField>([
  ["repo", { id: "F-repo", idModel: "B1", modelType: "board", name: "repo", type: "text", pos: 1 }],
]);

describe("resolveLabelIds", () => {
  test("maps known names to IDs in input order", () => {
    expect(resolveLabelIds(["intern-ok", "ww-ready"], labelMap)).toEqual([
      "L-intern",
      "L-ready",
    ]);
  });

  test("throws ResolutionError listing all missing names", () => {
    expect(() => resolveLabelIds(["typo1", "ww-ready", "typo2"], labelMap)).toThrow(
      ResolutionError,
    );
    try {
      resolveLabelIds(["typo1", "typo2"], labelMap);
    } catch (e) {
      expect((e as Error).message).toContain("typo1, typo2");
      expect((e as Error).message).toContain("intern-ok, ww-ready");
    }
  });

  test("empty input returns empty array", () => {
    expect(resolveLabelIds([], labelMap)).toEqual([]);
  });
});

describe("resolveListId", () => {
  test("maps known list to ID", () => {
    expect(resolveListId("Todo", listMap)).toBe("list-todo");
  });

  test("throws ResolutionError with helpful suggestions for unknown list", () => {
    expect(() => resolveListId("To-Do", listMap)).toThrow(ResolutionError);
    expect(() => resolveListId("To-Do", listMap)).toThrow(/Done, Todo/);
  });
});

describe("resolveCustomField", () => {
  test("maps known field to TrelloCustomField object", () => {
    const f = resolveCustomField("repo", fieldMap);
    expect(f.id).toBe("F-repo");
    expect(f.type).toBe("text");
  });

  test("throws ResolutionError for unknown field", () => {
    expect(() => resolveCustomField("nonexistent", fieldMap)).toThrow(ResolutionError);
  });
});
