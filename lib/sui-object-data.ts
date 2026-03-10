import { normalizeObjectId, type NetworkName } from "@/lib/sui-live-objects";

export const RPC_URLS = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
} as const;

const GET_OBJECT_OPTIONS = {
  showContent: true,
  showOwner: true,
  showPreviousTransaction: true,
  showType: true,
} as const;

export type ObjectDataResult = {
  objectId: string;
  version: string | number | null;
  digest: string | null;
  type: string | null;
  owner: string;
  previousTransaction: string | null;
  contentDataType: string | null;
  contentType: string | null;
  hasPublicTransfer: boolean | null;
  fields: unknown | null;
  normalizedFields: unknown | null;
};

export class JsonRpcError extends Error {}

function describeUnexpectedUpstreamResponse(rawText: string): string {
  const normalized = rawText.trim();
  if (!normalized) {
    return "The upstream service returned an empty response.";
  }

  if (/^<!doctype html/i.test(normalized) || /^<html/i.test(normalized)) {
    return "The upstream service returned an HTML error page instead of JSON. This usually means the Sui RPC endpoint or a gateway returned an error page.";
  }

  return `The upstream service returned an unexpected response instead of JSON: ${normalized.slice(0, 180)}`;
}

function ownerToString(owner: unknown): string {
  if (owner === null || owner === undefined) {
    return "unknown";
  }
  if (owner === "Immutable") {
    return "Immutable";
  }
  if (typeof owner === "string") {
    return owner;
  }
  if (typeof owner === "object") {
    if ("AddressOwner" in owner) {
      return `AddressOwner(${String(owner.AddressOwner)})`;
    }
    if ("ObjectOwner" in owner) {
      return `ObjectOwner(${String(owner.ObjectOwner)})`;
    }
    if ("Shared" in owner) {
      const shared =
        owner.Shared && typeof owner.Shared === "object" ? owner.Shared : {};
      const version =
        "initial_shared_version" in shared ? String(shared.initial_shared_version) : "?";
      return `Shared(initial_shared_version=${version})`;
    }
    if ("ConsensusV2" in owner) {
      return `ConsensusV2(${JSON.stringify(owner.ConsensusV2)})`;
    }
  }

  return JSON.stringify(owner);
}

function normalizeMoveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMoveValue(item));
  }

  if (value && typeof value === "object") {
    if ("id" in value && Object.keys(value).length === 1 && typeof value.id === "string") {
      return value.id;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeMoveValue(item)]),
    );
  }

  return value;
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    cache: "no-store",
  });

  const rawText = await response.text();
  let payload: {
    result?: T;
    error?: unknown;
  };

  try {
    payload = JSON.parse(rawText) as {
      result?: T;
      error?: unknown;
    };
  } catch {
    throw new JsonRpcError(
      `${method} returned HTTP ${response.status}. ${describeUnexpectedUpstreamResponse(rawText)}`,
    );
  }

  if (!response.ok) {
    throw new JsonRpcError(`${method} returned HTTP ${response.status}`);
  }
  if (payload.error) {
    throw new JsonRpcError(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  if (!payload.result) {
    throw new JsonRpcError(`${method} returned no result`);
  }

  return payload.result;
}

export async function fetchObjectData(options: {
  objectId: string;
  network?: NetworkName;
  rpcUrl?: string;
}): Promise<ObjectDataResult> {
  const objectId = normalizeObjectId(options.objectId);
  const rpcUrl = options.rpcUrl ?? RPC_URLS[options.network ?? "testnet"];

  const result = await rpcCall<{
    data?: {
      objectId: string;
      version?: string | number | null;
      digest?: string | null;
      type?: string | null;
      owner?: unknown;
      previousTransaction?: string | null;
      content?: {
        dataType?: string | null;
        type?: string | null;
        hasPublicTransfer?: boolean | null;
        fields?: unknown;
      } | null;
    } | null;
  }>(rpcUrl, "sui_getObject", [objectId, GET_OBJECT_OPTIONS]);

  const data = result.data;
  if (!data) {
    throw new JsonRpcError(`object ${objectId} was not found`);
  }

  const content = data.content ?? null;
  const fields = content?.fields ?? null;

  return {
    objectId: normalizeObjectId(data.objectId),
    version: data.version ?? null,
    digest: data.digest ?? null,
    type: data.type ?? null,
    owner: ownerToString(data.owner),
    previousTransaction: data.previousTransaction ?? null,
    contentDataType: content?.dataType ?? null,
    contentType: content?.type ?? null,
    hasPublicTransfer: content?.hasPublicTransfer ?? null,
    fields,
    normalizedFields: normalizeMoveValue(fields),
  };
}
