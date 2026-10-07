import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { privateHeaders, sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new NextResponse(null, {status: 403});
  const client = await supabaseServer();
  const { error } = await client.auth.signOut({scope: "local"});
  return NextResponse.json({ok: !error}, {status: error ? 503 : 200, headers: {...privateHeaders, "Clear-Site-Data": '"cache", "storage"'}});
}
