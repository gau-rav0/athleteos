import { NextResponse } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { dashboardQuery } from "@/lib/data/schema";
import { refreshInventory } from "@/lib/data/inventory";
import {
  boundedJson,
  BodyTooLarge,
  privateHeaders,
  sameOrigin,
} from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "REQUEST_REJECTED" },
      { status: 403, headers: privateHeaders },
    );
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return NextResponse.json(
      { error: "INVALID_BODY" },
      { status: 415, headers: privateHeaders },
    );
  let query;
  try {
    query = dashboardQuery
      .pick({ timezone: true })
      .strict()
      .parse(await boundedJson(request));
  } catch (error) {
    return NextResponse.json(
      { error: "INVALID_RANGE" },
      {
        status: error instanceof BodyTooLarge ? 413 : 400,
        headers: privateHeaders,
      },
    );
  }
  try {
    const client = await supabaseServer();
    const { data, error } = await client.auth.getUser();
    if (isAuthRetryableFetchError(error))
      return NextResponse.json(
        { error: "AUTH_SERVICE_UNAVAILABLE" },
        { status: 503, headers: privateHeaders },
      );
    if (error || !data.user)
      return NextResponse.json(
        { error: "AUTH_REQUIRED" },
        { status: 401, headers: privateHeaders },
      );
    // Ownership is derived inside the invoker RPC from the validated JWT.
    // No owner, raw payload, arbitrary TTL or batch controls are accepted.
    const result = await refreshInventory(
      client,
      query.timezone,
      request.signal,
    );
    return NextResponse.json(result, { headers: privateHeaders });
  } catch {
    console.warn("DASHBOARD_INVENTORY_FAILURE", { stage: "UNAVAILABLE" });
    return NextResponse.json(
      { error: "INVENTORY_REFRESH_UNAVAILABLE" },
      { status: 503, headers: privateHeaders },
    );
  }
}
