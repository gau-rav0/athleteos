import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "./server";
import { getUserSafely, isInvalidSession } from "./session-error";
export async function requireUser() {
  const client = await supabaseServer();
  // Keep Next's throwing redirect outside the transport catch. Exception
  // details may contain private endpoints/tokens and must never escape.
  const { data, error } = await getUserSafely(client);
  if (error && !isInvalidSession(error))
    throw new Error("AUTH_SERVICE_UNAVAILABLE");
  if (error || !data.user) redirect("/login");
  return { client, user: data.user };
}
