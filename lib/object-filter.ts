export type QueryableObjectRow = {
  objectId: string;
  objectType: string | null;
  owner: string;
  version: string;
  digest: string | null;
  typePackageId: string;
  contentsJson: unknown | null;
};

export function normalizeObjectQuery(value: string | null | undefined): string | null {
  const query = value?.trim().toLowerCase();
  return query ? query : null;
}

function jsonContainsQuery(value: unknown, query: string): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(query);
  }

  if (Array.isArray(value)) {
    return value.some((item) => jsonContainsQuery(item, query));
  }

  if (typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) => key.toLowerCase().includes(query) || jsonContainsQuery(item, query),
    );
  }

  return false;
}

export function objectMatchesObjectQuery(
  object: QueryableObjectRow,
  rawQuery: string | null | undefined,
): boolean {
  const query = normalizeObjectQuery(rawQuery);
  if (!query) {
    return true;
  }

  return (
    object.objectId.toLowerCase().includes(query) ||
    (object.objectType?.toLowerCase().includes(query) ?? false) ||
    object.owner.toLowerCase().includes(query) ||
    object.version.toLowerCase().includes(query) ||
    (object.digest?.toLowerCase().includes(query) ?? false) ||
    object.typePackageId.toLowerCase().includes(query) ||
    jsonContainsQuery(object.contentsJson, query)
  );
}
