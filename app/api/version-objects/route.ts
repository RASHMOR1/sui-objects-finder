import { NextResponse } from "next/server";

import {
  type NetworkName,
  GraphQlError,
  findLiveObjectsByVersion,
} from "@/lib/sui-live-objects";

type VersionObjectsRequestBody = {
  packageId?: string;
  network?: NetworkName;
  cursor?: string | null;
  pageSize?: number;
  sharedOnly?: boolean;
  objectQuery?: string;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: VersionObjectsRequestBody;

  try {
    body = (await request.json()) as VersionObjectsRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body.packageId) {
    return NextResponse.json({ error: "packageId is required." }, { status: 400 });
  }

  try {
    const result = await findLiveObjectsByVersion({
      packageId: body.packageId,
      network: body.network ?? "testnet",
      cursor: body.cursor ?? null,
      sharedOnly: body.sharedOnly ?? false,
      objectQuery: body.objectQuery,
      pageSize: body.pageSize,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message =
      error instanceof GraphQlError || error instanceof Error
        ? error.message
        : "Unexpected error";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
