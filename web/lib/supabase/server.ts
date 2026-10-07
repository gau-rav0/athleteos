import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const jar = await cookies();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("SERVER_CONFIGURATION_REQUIRED");
  return createServerClient(url, key, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: { getAll: () => jar.getAll(), setAll: (values) => {
      try { for (const { name, value, options } of values) jar.set(name, value, options); }
      catch { /* Server Components cannot write; proxy refreshes cookies. */ }
    } }
  });
}
