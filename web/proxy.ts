import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { boundedServerFetch } from "@/lib/supabase/transport";
import { privateHeaders } from "@/lib/security";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const pendingCookies = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    for (const [name, value] of Object.entries(privateHeaders))
      response.headers.set(name, value);
    return response;
  }
  const client = createServerClient(url, key, {
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        for (const cookie of values) {
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.set(cookie.name, cookie);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of pendingCookies.values())
          response.cookies.set(name, value, options);
      },
    },
    global: {
      fetch: (input, init) => boundedServerFetch(input, init, request.signal),
    },
  });
  // Validate against Auth, rather than trusting cookie session content.
  try {
    const { error } = await client.auth.getUser();
    if (isAuthRetryableFetchError(error)) throw new Error("AUTH_UNAVAILABLE");
  } catch {
    // An Auth outage is never treated as a validated session. Return a bounded,
    // redacted failure instead of rendering data or dumping exception details.
    response = NextResponse.json(
      { error: "AUTH_SERVICE_UNAVAILABLE" },
      {
        status: 503,
        headers: privateHeaders,
      },
    );
    for (const { name, value, options } of pendingCookies.values())
      response.cookies.set(name, value, options);
    return response;
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.append("Vary", "Cookie");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
