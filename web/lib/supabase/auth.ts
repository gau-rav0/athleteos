import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "./server";
export async function requireUser() {
  const client = await supabaseServer();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { client, user: data.user };
}
