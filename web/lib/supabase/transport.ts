import "server-only";
import { AuthApiError } from "@supabase/supabase-js";
import { isInvalidSession } from "./session-error";

export const SERVER_HTTP_TIMEOUT_MS = 10000;

function authUrl(input: RequestInfo | URL): URL | null {
  try {
    const configured = new URL(process.env.SUPABASE_URL!);
    const target = new URL(
      input instanceof Request ? input.url : String(input),
    );
    const prefix = `${configured.pathname.replace(/\/$/, "")}/auth/v1/`;
    return target.origin === configured.origin &&
      (target.pathname === `${prefix}user` ||
        (target.pathname === `${prefix}token` &&
          target.searchParams.get("grant_type") === "refresh_token"))
      ? target
      : null;
  } catch {
    return null;
  }
}

// Inspect only a small clone; never retain or log Auth bodies or credentials.
async function authBody(response: Response): Promise<Record<string, unknown>> {
  const reader = response.clone().body?.getReader();
  if (!reader) throw new Error("AUTH_RESPONSE_UNAVAILABLE");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) throw new Error("AUTH_RESPONSE_UNAVAILABLE");
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("AUTH_RESPONSE_UNAVAILABLE");
    return parsed as Record<string, unknown>;
  } finally {
    // A cloned stream's cancellation can await its original consumer.
    void reader.cancel().catch(() => {});
  }
}

// Bound Auth as well as RPC HTTP transport. Keep existing caller cancellation,
// including signals carried by Request objects, and never cache private data.
export async function boundedServerFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  requestSignal?: AbortSignal,
): Promise<Response> {
  // RPC callers already provide explicit 8s/12s budgets. Keep those intact;
  // Auth SDK requests have no signal and receive the default HTTP deadline.
  const explicit = init?.signal;
  let budget = explicit ?? AbortSignal.timeout(SERVER_HTTP_TIMEOUT_MS);
  // Every Request has a signal, even a plain Request with no deadline. Preserve
  // its cancellation without mistaking that implicit signal for a time budget.
  if (!explicit && input instanceof Request)
    budget = AbortSignal.any([input.signal, budget]);
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, budget])
    : budget;
  let response: Response | undefined;
  try {
    response = await fetch(input, { ...init, cache: "no-store", signal });
    const target = authUrl(input);
    if (target) {
      if (!response.ok) {
        const body = await authBody(response);
        const code =
          typeof body.code === "string"
            ? body.code
            : typeof body.error_code === "string"
              ? body.error_code
              : undefined;
        if (
          !isInvalidSession(
            new AuthApiError("AUTH_RESPONSE", response.status, code),
          )
        )
          throw new Error("AUTH_RESPONSE_UNAVAILABLE");
      } else if (
        target.pathname.endsWith("/token") &&
        target.searchParams.get("grant_type") === "refresh_token"
      ) {
        const body = await authBody(response);
        if (
          typeof body.access_token !== "string" ||
          !body.access_token ||
          typeof body.refresh_token !== "string" ||
          !body.refresh_token ||
          typeof body.expires_in !== "number" ||
          !Number.isFinite(body.expires_in) ||
          body.expires_in <= 0
        )
          throw new Error("AUTH_RESPONSE_UNAVAILABLE");
      } else {
        const body = await authBody(response);
        const user = body.user ?? body;
        if (
          !user ||
          typeof user !== "object" ||
          !("id" in user) ||
          typeof user.id !== "string" ||
          !user.id.trim()
        )
          throw new Error("AUTH_RESPONSE_UNAVAILABLE");
      }
    }
    return response;
  } catch {
    void response?.body?.cancel().catch(() => {});
    // Network exception details can include endpoints; no original exception or
    // request options escape this transport boundary or enter application logs.
    throw new Error("SERVER_TRANSPORT_UNAVAILABLE");
  }
}
