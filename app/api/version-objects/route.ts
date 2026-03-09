import { NextResponse } from "next/server";

import {
  type NetworkName,
  formatGraphQlErrorMessage,
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
    const network = body.network ?? "testnet";
    const result = await findLiveObjectsByVersion({
      packageId: body.packageId,
      network,
      cursor: body.cursor ?? null,
      sharedOnly: body.sharedOnly ?? false,
      objectQuery: body.objectQuery,
      pageSize: body.pageSize,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = formatGraphQlErrorMessage(error, body.network ?? "testnet");

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
