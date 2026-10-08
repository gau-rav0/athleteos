import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { dashboardQuery } from "@/lib/data/schema";
import { advanceProjection } from "@/lib/data/projection";
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
    query = dashboardQuery.strict().parse(await boundedJson(request));
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
    if (error || !data.user)
      return NextResponse.json(
        { error: "AUTH_REQUIRED" },
        { status: 401, headers: privateHeaders },
      );
    // The invoker RPC derives ownership from this validated user's JWT.
    // One bounded transaction; no arbitrary owner or client-selected batch size.
    const result = await advanceProjection(client, query.days, query.timezone);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch {
    console.warn("DASHBOARD_PROJECTION_FAILURE", { stage: "UNAVAILABLE" });
    return NextResponse.json(
      { error: "PROJECTION_WORK_UNAVAILABLE" },
      {
        status: 503,
        headers: privateHeaders,
      },
    );
  }
}
