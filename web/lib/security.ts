export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};
export function sameOrigin(request: Request): boolean {
  return (
    request.headers.get("origin") ===
    new URL(process.env.APP_ORIGIN || request.url).origin
  );
}
export class BodyTooLarge extends Error {}
export async function boundedJson(
  request: Request,
  limit = 4096,
): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new BodyTooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
