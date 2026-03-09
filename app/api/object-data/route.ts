import { NextResponse } from "next/server";

import { JsonRpcError, fetchObjectData } from "@/lib/sui-object-data";
import type { NetworkName } from "@/lib/sui-live-objects";

type ObjectDataRequestBody = {
  objectId?: string;
  network?: NetworkName;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: ObjectDataRequestBody;

  try {
    body = (await request.json()) as ObjectDataRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body.objectId) {
    return NextResponse.json({ error: "objectId is required." }, { status: 400 });
  }

  try {
    const result = await fetchObjectData({
      objectId: body.objectId,
      network: body.network ?? "testnet",
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message =
      error instanceof JsonRpcError || error instanceof Error
        ? error.message
        : "Unexpected error";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
