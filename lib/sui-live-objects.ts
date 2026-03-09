export const GRAPHQL_URLS = {
  mainnet: "https://graphql.mainnet.sui.io/graphql",
  testnet: "https://graphql.testnet.sui.io/graphql",
  devnet: "https://graphql.devnet.sui.io/graphql",
} as const;

export type NetworkName = keyof typeof GRAPHQL_URLS;

export type PackageVersion = {
  packageId: string;
  version: number | null;
  digest: string | null;
  relation: "current" | "before" | "after" | "exact";
};

export type LiveObjectRow = {
  objectId: string;
  objectType: string | null;
  owner: string;
  version: string;
  digest: string | null;
  typePackageId: string;
  contentsJson: unknown | null;
};

export type LiveObjectResult = {
  packageId: string;
  graphqlUrl: string;
  packageVersions: PackageVersion[];
  count: number;
  objects: LiveObjectRow[];
  objectsByVersion: Record<string, LiveObjectRow[]>;
  objectsOmitted: boolean;
  objectsOmittedReason: string | null;
};

export type VersionObjectsResult = {
  packageId: string;
  graphqlUrl: string;
  count: number;
  objects: LiveObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
  pageSize: number;
};

type LiveObjectFilterOptions = {
  sharedOnly?: boolean;
  objectQuery?: string;
};

const LIVE_OBJECTS_QUERY = `
query LivePackageObjects($type: String!, $first: Int!, $after: String) {
  objects(first: $first, after: $after, filter: { type: $type }) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      address
      version
      digest
      owner {
        __typename
      }
      asMoveObject {
        contents {
          json
          type {
            repr
          }
        }
      }
    }
  }
}
`;

const PACKAGE_VERSIONS_QUERY = `
query PackageVersions($address: SuiAddress!, $first: Int!, $afterBefore: String, $afterAfter: String) {
  object(address: $address) {
    asMovePackage {
      address
      version
      digest
      packageVersionsBefore(first: $first, after: $afterBefore) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          address
          version
          digest
        }
      }
      packageVersionsAfter(first: $first, after: $afterAfter) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          address
          version
          digest
        }
      }
    }
  }
}
`;

export class GraphQlError extends Error {}
export class ObjectHistoryLimitError extends Error {}

const DEFAULT_OBJECT_SCAN_PAGE_LIMIT = 8;
const DEFAULT_OBJECT_SCAN_ROW_LIMIT = 200;
const DEFAULT_VERSION_OBJECT_PAGE_SIZE = 10;
const MAX_VERSION_OBJECT_PAGE_SIZE = 25;
const VERSION_OBJECT_RAW_FETCH_PAGE_SIZE = 25;
const GRAPHQL_TIMEOUT_MS = 15_000;

export function normalizeObjectId(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw.startsWith("0x")) {
    throw new Error(`expected a 0x-prefixed object id, got ${value}`);
  }

  const hexPart = raw.slice(2);
  if (!hexPart) {
    throw new Error("object id cannot be empty");
  }
  if (hexPart.length > 64) {
    throw new Error(`object id is too long: ${value}`);
  }
  if (!/^[0-9a-f]+$/.test(hexPart)) {
    throw new Error(`object id contains non-hex characters: ${value}`);
  }

  return `0x${hexPart.padStart(64, "0")}`;
}

function ownerToString(owner: { __typename?: string } | null | undefined): string {
  return owner?.__typename ?? "unknown";
}

async function graphqlCall<TData>(
  graphqlUrl: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, GRAPHQL_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GraphQlError(`GraphQL request timed out after ${GRAPHQL_TIMEOUT_MS / 1000}s`);
    }

    throw error instanceof Error ? new GraphQlError(error.message) : new GraphQlError("GraphQL request failed");
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json()) as {
    data?: TData;
    errors?: unknown;
  };

  if (!response.ok) {
    throw new GraphQlError(`GraphQL request failed with HTTP ${response.status}`);
  }
  if (payload.errors) {
    throw new GraphQlError(`GraphQL query failed: ${JSON.stringify(payload.errors)}`);
  }
  if (!payload.data) {
    throw new GraphQlError("GraphQL response did not include a data field");
  }

  return payload.data;
}

type PackageVersionsResponse = {
  object: {
    asMovePackage: {
      address: string;
      version: number;
      digest: string | null;
      packageVersionsBefore: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: Array<{
          address: string;
          version: number;
          digest: string | null;
        }>;
      };
      packageVersionsAfter: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: Array<{
          address: string;
          version: number;
          digest: string | null;
        }>;
      };
    } | null;
  } | null;
};

type MovePackageNode = NonNullable<NonNullable<PackageVersionsResponse["object"]>["asMovePackage"]>;

type LiveObjectsResponse = {
  objects: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    nodes: Array<{
      address: string;
      version: number | string;
      digest: string | null;
      owner?: {
        __typename?: string;
      } | null;
      asMoveObject?: {
        contents?: {
          json?: unknown;
          type?: {
            repr?: string | null;
          } | null;
        } | null;
      } | null;
    }>;
  } | null;
};

type LiveObjectPageResult = {
  objects: LiveObjectRow[];
  hasNextPage: boolean;
  nextCursor: string | null;
};

type VersionObjectCursorState = {
  rawCursor: string | null;
  bufferedRows: LiveObjectRow[];
  rawHasNextPage: boolean;
};

function compareLiveObjectRows(left: LiveObjectRow, right: LiveObjectRow): number {
  const typeCompare = (left.objectType ?? "").localeCompare(right.objectType ?? "");
  if (typeCompare !== 0) {
    return typeCompare;
  }

  return left.objectId.localeCompare(right.objectId);
}

function isPackageDefinedObjectType(objectType: string | null | undefined, packageId: string): boolean {
  if (!objectType) {
    return false;
  }

  return objectType.toLowerCase().startsWith(`${packageId.toLowerCase()}::`);
}

function isSuiRelatedObjectType(objectType: string | null | undefined): boolean {
  if (!objectType) {
    return false;
  }

  return /0x0*2::sui::sui/i.test(objectType);
}

function isSharedOwner(owner: string): boolean {
  return owner === "Shared";
}

function normalizeObjectQuery(value: string | undefined): string | null {
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

function mapLiveObjectRows(
  nodes: NonNullable<LiveObjectsResponse["objects"]>["nodes"],
  typeFilter: string,
  filters?: LiveObjectFilterOptions,
): LiveObjectRow[] {
  const objectQuery = normalizeObjectQuery(filters?.objectQuery);

  return nodes
    .map((node) => ({
      objectId: normalizeObjectId(node.address),
      objectType: node.asMoveObject?.contents?.type?.repr ?? null,
      owner: ownerToString(node.owner),
      version: String(node.version),
      digest: node.digest,
      typePackageId: typeFilter,
      contentsJson: node.asMoveObject?.contents?.json ?? null,
    }))
    .filter(
      (row) =>
        isPackageDefinedObjectType(row.objectType, typeFilter) &&
        !isSuiRelatedObjectType(row.objectType) &&
        (!filters?.sharedOnly || isSharedOwner(row.owner)) &&
        (!objectQuery || jsonContainsQuery(row.contentsJson, objectQuery)),
    );
}

function compactLiveObjectRow(row: LiveObjectRow): LiveObjectRow {
  return {
    objectId: row.objectId,
    objectType: row.objectType,
    owner: row.owner,
    version: row.version,
    digest: row.digest,
    typePackageId: row.typePackageId,
    contentsJson: null,
  };
}

function encodeVersionObjectCursor(state: VersionObjectCursorState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function decodeVersionObjectCursor(value: string | null | undefined): VersionObjectCursorState {
  if (!value) {
    return {
      rawCursor: null,
      bufferedRows: [],
      rawHasNextPage: true,
    };
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<VersionObjectCursorState>;
    return {
      rawCursor: typeof decoded.rawCursor === "string" || decoded.rawCursor === null ? decoded.rawCursor : null,
      bufferedRows: Array.isArray(decoded.bufferedRows)
        ? decoded.bufferedRows.map((row) => compactLiveObjectRow(row as LiveObjectRow))
        : [],
      rawHasNextPage: typeof decoded.rawHasNextPage === "boolean" ? decoded.rawHasNextPage : true,
    };
  } catch {
    return {
      rawCursor: value,
      bufferedRows: [],
      rawHasNextPage: true,
    };
  }
}

export async function fetchPackageVersions(
  graphqlUrl: string,
  packageId: string,
  networkName = "selected network",
  pageSize = 50,
): Promise<PackageVersion[]> {
  let beforeCursor: string | null = null;
  let afterCursor: string | null = null;
  const versions = new Map<string, PackageVersion>();

  while (true) {
    const data: PackageVersionsResponse = await graphqlCall<PackageVersionsResponse>(
      graphqlUrl,
      PACKAGE_VERSIONS_QUERY,
      {
        address: packageId,
        first: pageSize,
        afterBefore: beforeCursor,
        afterAfter: afterCursor,
      },
    );

    const packageObject: MovePackageNode | null = data.object?.asMovePackage ?? null;
    if (!packageObject) {
      throw new GraphQlError(`${packageId} was not found as a Move package on ${networkName}`);
    }

    const currentAddress = normalizeObjectId(packageObject.address);
    versions.set(currentAddress, {
      packageId: currentAddress,
      version: packageObject.version,
      digest: packageObject.digest,
      relation: "current",
    });

    for (const node of packageObject.packageVersionsBefore.nodes ?? []) {
      const address = normalizeObjectId(node.address);
      versions.set(address, {
        packageId: address,
        version: node.version,
        digest: node.digest,
        relation: "before",
      });
    }

    for (const node of packageObject.packageVersionsAfter.nodes ?? []) {
      const address = normalizeObjectId(node.address);
      versions.set(address, {
        packageId: address,
        version: node.version,
        digest: node.digest,
        relation: "after",
      });
    }

    const beforeInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    } = packageObject.packageVersionsBefore.pageInfo;
    const afterInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    } = packageObject.packageVersionsAfter.pageInfo;
    if (!beforeInfo.hasNextPage && !afterInfo.hasNextPage) {
      break;
    }
    if (beforeInfo.hasNextPage && !beforeInfo.endCursor) {
      throw new GraphQlError("packageVersionsBefore indicated another page but did not return endCursor");
    }
    if (afterInfo.hasNextPage && !afterInfo.endCursor) {
      throw new GraphQlError("packageVersionsAfter indicated another page but did not return endCursor");
    }

    beforeCursor = beforeInfo.endCursor;
    afterCursor = afterInfo.endCursor;
  }

  return [...versions.values()].sort((left, right) => {
    const leftVersion = left.version ?? Number.MAX_SAFE_INTEGER;
    const rightVersion = right.version ?? Number.MAX_SAFE_INTEGER;
    if (leftVersion !== rightVersion) {
      return leftVersion - rightVersion;
    }
    return left.packageId.localeCompare(right.packageId);
  });
}

export async function fetchLivePackageObjects(
  graphqlUrl: string,
  typeFilter: string,
  options?: {
    pageSize?: number;
    after?: string | null;
    filters?: LiveObjectFilterOptions;
    scanBudget?: {
      remainingPages: number;
      remainingRows: number;
    };
  },
): Promise<LiveObjectPageResult> {
  const pageSize = options?.pageSize ?? 50;
  const scanBudget = options?.scanBudget;

  if (scanBudget && scanBudget.remainingPages <= 0) {
    throw new ObjectHistoryLimitError(
      "Object scan skipped because this package has too much historical object data.",
    );
  }

  const data: LiveObjectsResponse = await graphqlCall<LiveObjectsResponse>(
    graphqlUrl,
    LIVE_OBJECTS_QUERY,
    {
      type: typeFilter,
      first: pageSize,
      after: options?.after ?? null,
    },
  );

  const objects: LiveObjectsResponse["objects"] = data.objects;
  if (!objects) {
    throw new GraphQlError("GraphQL response did not include objects");
  }

  if (scanBudget) {
    scanBudget.remainingPages -= 1;
    scanBudget.remainingRows -= objects.nodes.length;
    if (scanBudget.remainingRows < 0) {
      throw new ObjectHistoryLimitError(
        "Object scan skipped because this package has too much historical object data.",
      );
    }
  }

  if (objects.pageInfo.hasNextPage && !objects.pageInfo.endCursor) {
    throw new GraphQlError("GraphQL response indicated another page but did not return endCursor");
  }

  return {
    objects: mapLiveObjectRows(objects.nodes, typeFilter, options?.filters),
    hasNextPage: objects.pageInfo.hasNextPage,
    nextCursor: objects.pageInfo.hasNextPage ? objects.pageInfo.endCursor : null,
  };
}

export async function fetchAllLivePackageObjects(
  graphqlUrl: string,
  typeFilter: string,
  options?: {
    pageSize?: number;
    filters?: LiveObjectFilterOptions;
    scanBudget?: {
      remainingPages: number;
      remainingRows: number;
    };
  },
): Promise<LiveObjectRow[]> {
  let cursor: string | null = null;
  const rows: LiveObjectRow[] = [];

  while (true) {
    const page = await fetchLivePackageObjects(graphqlUrl, typeFilter, {
      pageSize: options?.pageSize,
      after: cursor,
      filters: options?.filters,
      scanBudget: options?.scanBudget,
    });

    rows.push(...page.objects);

    if (!page.hasNextPage) {
      break;
    }

    cursor = page.nextCursor;
  }

  return rows.sort(compareLiveObjectRows);
}

export async function findLiveObjectsByPackage(options: {
  packageId: string;
  network?: NetworkName;
  graphqlUrl?: string;
  exactPackageOnly?: boolean;
  sharedOnly?: boolean;
  objectQuery?: string;
  pageSize?: number;
  maxObjectScanPages?: number;
  maxObjectScanRows?: number;
}): Promise<LiveObjectResult> {
  const packageId = normalizeObjectId(options.packageId);
  const graphqlUrl = options.graphqlUrl ?? GRAPHQL_URLS[options.network ?? "testnet"];
  const pageSize = options.pageSize ?? 50;

  const packageVersions = options.exactPackageOnly
    ? [
        {
          packageId,
          version: null,
          digest: null,
          relation: "exact" as const,
        },
      ]
    : await fetchPackageVersions(
        graphqlUrl,
        packageId,
        options.network ?? "selected network",
        pageSize,
      );

  const emptyObjectsByVersion = Object.fromEntries(
    packageVersions.map((packageVersion) => [
      packageVersion.version === null ? packageVersion.packageId : `v${packageVersion.version}`,
      [],
    ]),
  ) as Record<string, LiveObjectRow[]>;

  const objectsByVersion: Record<string, LiveObjectRow[]> = {};
  const objects: LiveObjectRow[] = [];
  const scanBudget = {
    remainingPages: options.maxObjectScanPages ?? DEFAULT_OBJECT_SCAN_PAGE_LIMIT,
    remainingRows: options.maxObjectScanRows ?? DEFAULT_OBJECT_SCAN_ROW_LIMIT,
  };

  for (const packageVersion of packageVersions) {
    const versionKey =
      packageVersion.version === null ? packageVersion.packageId : `v${packageVersion.version}`;
    const versionRows = await fetchAllLivePackageObjects(graphqlUrl, packageVersion.packageId, {
      pageSize,
      filters: {
        objectQuery: options.objectQuery,
        sharedOnly: options.sharedOnly ?? false,
      },
      scanBudget,
    }).catch((error: unknown) => {
      if (error instanceof ObjectHistoryLimitError) {
        return null;
      }

      throw error;
    });

    if (versionRows === null) {
      return {
        packageId,
        graphqlUrl,
        packageVersions,
        count: 0,
        objects: [],
        objectsByVersion: emptyObjectsByVersion,
        objectsOmitted: true,
        objectsOmittedReason:
          "Object scan skipped because this package has too much historical object data.",
      };
    }

    objectsByVersion[versionKey] = versionRows;
    objects.push(...versionRows);
  }

  objects.sort((left, right) => {
    const packageCompare = left.typePackageId.localeCompare(right.typePackageId);
    if (packageCompare !== 0) {
      return packageCompare;
    }
    const typeCompare = (left.objectType ?? "").localeCompare(right.objectType ?? "");
    if (typeCompare !== 0) {
      return typeCompare;
    }
    return left.objectId.localeCompare(right.objectId);
  });

  return {
    packageId,
    graphqlUrl,
    packageVersions,
    count: objects.length,
    objects,
    objectsByVersion,
    objectsOmitted: false,
    objectsOmittedReason: null,
  };
}

export async function findLiveObjectsByVersion(options: {
  packageId: string;
  network?: NetworkName;
  graphqlUrl?: string;
  cursor?: string | null;
  sharedOnly?: boolean;
  objectQuery?: string;
  pageSize?: number;
}): Promise<VersionObjectsResult> {
  const packageId = normalizeObjectId(options.packageId);
  const graphqlUrl = options.graphqlUrl ?? GRAPHQL_URLS[options.network ?? "testnet"];
  const pageSize = Math.min(
    Math.max(options.pageSize ?? DEFAULT_VERSION_OBJECT_PAGE_SIZE, 1),
    MAX_VERSION_OBJECT_PAGE_SIZE,
  );
  const cursorState = decodeVersionObjectCursor(options.cursor);
  const objects: LiveObjectRow[] = [];
  let bufferedRows = [...cursorState.bufferedRows];
  let rawCursor = cursorState.rawCursor;
  let rawHasNextPage = cursorState.rawHasNextPage;

  while (objects.length < pageSize) {
    if (bufferedRows.length > 0) {
      const needed = pageSize - objects.length;
      objects.push(...bufferedRows.slice(0, needed));
      bufferedRows = bufferedRows.slice(needed);

      if (objects.length >= pageSize) {
        break;
      }
    }

    if (!rawHasNextPage) {
      break;
    }

    const page = await fetchLivePackageObjects(graphqlUrl, packageId, {
      after: rawCursor,
      pageSize: VERSION_OBJECT_RAW_FETCH_PAGE_SIZE,
      filters: {
        objectQuery: options.objectQuery,
        sharedOnly: options.sharedOnly ?? false,
      },
    });

    rawCursor = page.nextCursor;
    rawHasNextPage = page.hasNextPage;
    bufferedRows.push(...page.objects.map(compactLiveObjectRow));
  }

  const hasNextPage = bufferedRows.length > 0 || rawHasNextPage;
  const nextCursor = hasNextPage
    ? encodeVersionObjectCursor({
        rawCursor,
        bufferedRows,
        rawHasNextPage,
      })
    : null;

  return {
    packageId,
    graphqlUrl,
    count: objects.length,
    objects,
    hasNextPage,
    nextCursor,
    pageSize,
  };
}
