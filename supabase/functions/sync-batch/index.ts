import { createHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL");
const publicKey = Deno.env.get("SUPABASE_ANON_KEY");
if (!url || !publicKey) throw new Error("SERVER_CONFIGURATION_REQUIRED");
Deno.serve(createHandler({ url, publicKey }));
