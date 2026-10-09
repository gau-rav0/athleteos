import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { privateHeaders, sameOrigin, boundedJson, BodyTooLarge } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json(
      { error: "REQUEST_REJECTED" },
      { status: 403, headers: privateHeaders },
    );
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return new NextResponse(null, { status: 413 });
  try {
    const credentials = z
      .object({
        email: z.email().max(254),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .parse(await boundedJson(request));
    const client = await supabaseServer();
    const { error } = await client.auth.signInWithPassword(credentials);
    if (error)
      return NextResponse.json(
        { error: "SIGN_IN_FAILED" },
        { status: 401, headers: privateHeaders },
      );
    return NextResponse.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: "SIGN_IN_UNAVAILABLE" },
      { status: error instanceof BodyTooLarge ? 413 : 400, headers: privateHeaders },
    );
  }
}
