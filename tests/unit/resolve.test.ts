import { describe, test, expect } from "vitest";
import {
  resolveLabelIds,
  resolveLabelRefs,
  resolveMemberIds,
  resolveListId,
  resolveCustomField,
  ResolutionError,
} from "../../src/lib/resolve.js";
import type {
  TrelloLabel,
  TrelloList,
  TrelloCustomField,
  TrelloMember,
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

describe("resolveLabelRefs (name, with unnamed-color fallback)", () => {
  // Mirrors the real board: named ww-* labels share colors with unnamed
  // "category" labels. A bare color token should pick the UNNAMED one.
  const allLabels: TrelloLabel[] = [
    { id: "L-ready", idBoard: "B1", name: "ww-ready", color: "green" },
    { id: "L-working", idBoard: "B1", name: "ww-working", color: "orange" },
    { id: "L-orange", idBoard: "B1", name: "", color: "orange" },
    { id: "L-green", idBoard: "B1", name: "", color: "green" },
    { id: "L-blue", idBoard: "B1", name: "", color: "blue" },
  ];

  test("resolves by exact name first", () => {
    expect(resolveLabelRefs(["ww-ready"], allLabels)).toEqual(["L-ready"]);
  });

  test("resolves a bare color to the UNNAMED label of that color", () => {
    expect(resolveLabelRefs(["orange"], allLabels)).toEqual(["L-orange"]);
    expect(resolveLabelRefs(["blue"], allLabels)).toEqual(["L-blue"]);
  });

  test("mixes names and colors in input order", () => {
    expect(resolveLabelRefs(["ww-working", "green"], allLabels)).toEqual([
      "L-working",
      "L-green",
    ]);
  });

  test("throws listing unknown tokens", () => {
    expect(() => resolveLabelRefs(["chartreuse"], allLabels)).toThrow(ResolutionError);
  });

  test("throws when a color has no unnamed label", () => {
    const noUnnamed: TrelloLabel[] = [
      { id: "L-stuck", idBoard: "B1", name: "ww-stuck", color: "red" },
    ];
    expect(() => resolveLabelRefs(["red"], noUnnamed)).toThrow(ResolutionError);
  });

  test("throws when two unnamed labels share a color (ambiguous)", () => {
    const ambiguous: TrelloLabel[] = [
      { id: "L-o1", idBoard: "B1", name: "", color: "orange" },
      { id: "L-o2", idBoard: "B1", name: "", color: "orange" },
    ];
    expect(() => resolveLabelRefs(["orange"], ambiguous)).toThrow(/ambiguous/i);
  });
});

describe("resolveMemberIds", () => {
  const members: TrelloMember[] = [
    { id: "m-rahul", username: "rahulpawar", fullName: "Rahul Pawar" },
    { id: "m-aakash", username: "aakash424", fullName: "Aakash" },
  ];

  test("matches by username", () => {
    expect(resolveMemberIds(["rahulpawar"], members)).toEqual(["m-rahul"]);
  });

  test("matches by full name, case-insensitive", () => {
    expect(resolveMemberIds(["rahul pawar"], members)).toEqual(["m-rahul"]);
  });

  test("matches by id passthrough", () => {
    expect(resolveMemberIds(["m-aakash"], members)).toEqual(["m-aakash"]);
  });

  test("throws ResolutionError listing known members for an unknown token", () => {
    expect(() => resolveMemberIds(["nobody"], members)).toThrow(ResolutionError);
    try {
      resolveMemberIds(["nobody"], members);
    } catch (e) {
      expect((e as Error).message).toContain("rahulpawar");
    }
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
