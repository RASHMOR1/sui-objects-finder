import { NextResponse } from "next/server";

import {
  type NetworkName,
  formatGraphQlErrorMessage,
  findLiveObjectsByPackage,
} from "@/lib/sui-live-objects";

type SearchRequestBody = {
  packageId?: string;
  network?: NetworkName;
  exactPackageOnly?: boolean;
  sharedOnly?: boolean;
  objectQuery?: string;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: SearchRequestBody;

  try {
    body = (await request.json()) as SearchRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body.packageId) {
    return NextResponse.json({ error: "packageId is required." }, { status: 400 });
  }

  try {
    const network = body.network ?? "testnet";
    const result = await findLiveObjectsByPackage({
      packageId: body.packageId,
      network,
      exactPackageOnly: body.exactPackageOnly ?? false,
      sharedOnly: body.sharedOnly ?? false,
      objectQuery: body.objectQuery,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = formatGraphQlErrorMessage(error, body.network ?? "testnet");

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
