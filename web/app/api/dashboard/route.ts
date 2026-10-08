import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { dashboardQuery } from "@/lib/data/schema";
import { loadDashboard } from "@/lib/data/load";
import { privateHeaders } from "@/lib/security";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const client = await supabaseServer(),
      { data, error } = await client.auth.getUser();
    if (error || !data.user)
      return NextResponse.json(
        { error: "AUTH_REQUIRED" },
        { status: 401, headers: privateHeaders },
      );
    const url = new URL(request.url),
      query = dashboardQuery.safeParse({
        days: url.searchParams.get("days") || 28,
        timezone: url.searchParams.get("timezone") || "Asia/Kolkata",
      });
    if (!query.success)
      return NextResponse.json(
        { error: "INVALID_RANGE" },
        { status: 400, headers: privateHeaders },
      );
    const result = await loadDashboard(
      client,
      query.data.days,
      query.data.timezone,
    );
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    const safeStages = [
      "DATA_SUMMARIES_UNAVAILABLE",
      "DATA_READ_UNAVAILABLE",
      "DATA_INVENTORY_UNAVAILABLE",
    ];
    console.warn("DASHBOARD_DATA_FAILURE", {
      stage:
        error instanceof Error && safeStages.includes(error.message)
          ? error.message
          : error instanceof Error && error.name === "ZodError"
            ? "INVENTORY_SCHEMA"
            : "UNAVAILABLE",
    });
    return NextResponse.json(
      { error: "DASHBOARD_DATA_UNAVAILABLE" },
      { status: 503, headers: privateHeaders },
    );
  }
}
