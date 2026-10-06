import { object, validBatch } from "./validation.ts";

export interface Environment {
  url: string;
  publicKey: string;
}
const MAX_BYTES = 8 * 1024 * 1024;
function response(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function createHandler(
  env: Environment,
  transport: typeof fetch = fetch,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return response(405, { error: "METHOD_NOT_ALLOWED" });
    }
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer \S+$/.test(authorization)) {
      return response(401, { error: "AUTH_REQUIRED" });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return response(415, { error: "JSON_REQUIRED" });
    }
    try {
      // Authenticate with Supabase Auth; decoding JWT claims alone is never validation.
      const auth = await transport(`${env.url}/auth/v1/user`, {
        headers: { apikey: env.publicKey, Authorization: authorization },
        signal: AbortSignal.timeout(15000),
      });
      if (!auth.ok) {
        return response(auth.status >= 500 ? 503 : 401, {
          error: "AUTH_FAILED",
        });
      }
      const user = await auth.json();
      if (!object(user) || typeof user.id !== "string") {
        return response(401, { error: "AUTH_FAILED" });
      }
      if (Number(request.headers.get("content-length")) > MAX_BYTES) {
        return response(413, { error: "BATCH_TOO_LARGE" });
      }
      // Stream with a bound; never allocate an unbounded untrusted request body.
      const reader = request.body?.getReader();
      if (!reader) return response(400, { error: "INVALID_BATCH" });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return response(413, { error: "BATCH_TOO_LARGE" });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let position = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, position);
        position += chunk.length;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return response(400, { error: "INVALID_JSON" });
      }
      if (!validBatch(body)) return response(400, { error: "INVALID_BATCH" });
      // The RPC uses auth.uid() from this same validated caller JWT and obeys RLS.
      const result = await transport(
        `${env.url}/rest/v1/rpc/ingest_health_batch`,
        {
          method: "POST",
          headers: {
            apikey: env.publicKey,
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            p_device: body.device,
            p_records: body.records,
            p_runs: body.runs,
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!result.ok) return response(503, { error: "PERSISTENCE_FAILED" });
      const acknowledgement = await result.json();
      if (
        !object(acknowledgement) ||
        acknowledgement.accepted !== body.records.length ||
        acknowledgement.runs_accepted !== body.runs.length
      ) {
        return response(503, { error: "INVALID_ACKNOWLEDGEMENT" });
      }
      return response(200, acknowledgement);
    } catch {
      // Never log requests, JWTs, payloads or exception messages.
      return response(503, { error: "SYNC_UNAVAILABLE" });
    }
  };
}
