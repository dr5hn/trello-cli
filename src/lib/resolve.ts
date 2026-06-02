/**
 * Resolve human-friendly names (label names, list names, custom field names)
 * to Trello internal IDs. Called once at the start of any command that takes
 * names from the user; results are returned as Maps so callers can do many
 * lookups without re-fetching.
 */

import {
  TrelloClient,
  type TrelloLabel,
  type TrelloList,
  type TrelloCustomField,
  type TrelloMember,
} from "../trello-client.js";

export class ResolutionError extends Error {
  override readonly name = "ResolutionError";
  constructor(message: string) {
    super(message);
  }
}

/** Map of `name → label` for all labels on the board, exact-name match. */
export async function loadLabelMap(
  client: TrelloClient,
  boardId: string,
): Promise<Map<string, TrelloLabel>> {
  const labels = await client.labelsOnBoard(boardId);
  const map = new Map<string, TrelloLabel>();
  for (const label of labels) {
    if (label.name.length > 0) map.set(label.name, label);
  }
  return map;
}

export async function loadListMap(
  client: TrelloClient,
  boardId: string,
): Promise<Map<string, TrelloList>> {
  const lists = await client.listsOnBoard(boardId, "open");
  const map = new Map<string, TrelloList>();
  for (const list of lists) {
    map.set(list.name, list);
  }
  return map;
}

export async function loadCustomFieldMap(
  client: TrelloClient,
  boardId: string,
): Promise<Map<string, TrelloCustomField>> {
  const fields = await client.customFieldsOnBoard(boardId);
  const map = new Map<string, TrelloCustomField>();
  for (const field of fields) {
    map.set(field.name, field);
  }
  return map;
}

/**
 * Resolve a list of label names to label IDs. Throws ResolutionError naming
 * every missing name (don't fail-fast — show the user all the typos at once).
 */
export function resolveLabelIds(
  names: ReadonlyArray<string>,
  labelMap: ReadonlyMap<string, TrelloLabel>,
): string[] {
  const missing: string[] = [];
  const ids: string[] = [];
  for (const name of names) {
    const label = labelMap.get(name);
    if (!label) missing.push(name);
    else ids.push(label.id);
  }
  if (missing.length > 0) {
    const known = Array.from(labelMap.keys()).sort().join(", ");
    throw new ResolutionError(
      `Unknown label name(s): ${missing.join(", ")}. Known: ${known || "(none)"}`,
    );
  }
  return ids;
}

/**
 * Resolve label *references* — either an exact label name, or a bare colour
 * token (e.g. "orange") that maps to the board's single UNNAMED label of that
 * colour. Trello "category" labels are often left unnamed, so they can't be hit
 * by name; selecting them by colour is the only ergonomic handle. Named labels
 * always win over the colour fallback, so `ww-working` (orange) and the unnamed
 * orange category label stay independently addressable.
 *
 * @throws ResolutionError for unknown tokens, a colour with no unnamed label,
 *   or an ambiguous colour (more than one unnamed label sharing it).
 */
export function resolveLabelRefs(
  tokens: ReadonlyArray<string>,
  allLabels: ReadonlyArray<TrelloLabel>,
): string[] {
  const byName = new Map<string, TrelloLabel>();
  for (const label of allLabels) {
    if (label.name.length > 0) byName.set(label.name, label);
  }

  const ids: string[] = [];
  const errors: string[] = [];
  for (const token of tokens) {
    const named = byName.get(token);
    if (named) {
      ids.push(named.id);
      continue;
    }
    const unnamedOfColor = allLabels.filter(
      (l) => l.name.length === 0 && l.color === token,
    );
    if (unnamedOfColor.length === 1) {
      ids.push(unnamedOfColor[0]!.id);
    } else if (unnamedOfColor.length > 1) {
      errors.push(`"${token}" is ambiguous (${unnamedOfColor.length} unnamed labels share that colour)`);
    } else {
      errors.push(`"${token}"`);
    }
  }
  if (errors.length > 0) {
    const knownNames = Array.from(byName.keys()).sort();
    const knownColors = Array.from(
      new Set(allLabels.filter((l) => l.name.length === 0).map((l) => l.color)),
    ).sort();
    throw new ResolutionError(
      `Could not resolve label(s): ${errors.join(", ")}. ` +
        `Known names: ${knownNames.join(", ") || "(none)"}. ` +
        `Known colours: ${knownColors.join(", ") || "(none)"}.`,
    );
  }
  return ids;
}

/**
 * Resolve member references to member IDs. Accepts a Trello member id,
 * `username`, or `fullName` (case-insensitive) — whichever the user finds
 * handy. Errors name every unknown token plus the known members so a typo is
 * obvious.
 */
export function resolveMemberIds(
  tokens: ReadonlyArray<string>,
  members: ReadonlyArray<TrelloMember>,
): string[] {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const token of tokens) {
    const needle = token.toLowerCase();
    const match = members.find(
      (m) =>
        m.id === token ||
        m.username.toLowerCase() === needle ||
        m.fullName.toLowerCase() === needle,
    );
    if (match) ids.push(match.id);
    else missing.push(token);
  }
  if (missing.length > 0) {
    const known = members
      .map((m) => `${m.username} (${m.fullName})`)
      .sort()
      .join(", ");
    throw new ResolutionError(
      `Unknown member(s): ${missing.join(", ")}. Known: ${known || "(none)"}`,
    );
  }
  return ids;
}

export function resolveListId(
  name: string,
  listMap: ReadonlyMap<string, TrelloList>,
): string {
  const list = listMap.get(name);
  if (!list) {
    const known = Array.from(listMap.keys()).sort().join(", ");
    throw new ResolutionError(
      `Unknown list name: "${name}". Known: ${known || "(none)"}`,
    );
  }
  return list.id;
}

export function resolveCustomField(
  name: string,
  fieldMap: ReadonlyMap<string, TrelloCustomField>,
): TrelloCustomField {
  const field = fieldMap.get(name);
  if (!field) {
    const known = Array.from(fieldMap.keys()).sort().join(", ");
    throw new ResolutionError(
      `Unknown custom field: "${name}". Known: ${known || "(none)"}`,
    );
  }
  return field;
}
