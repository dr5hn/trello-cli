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
