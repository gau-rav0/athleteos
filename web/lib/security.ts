export const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie" };
export function sameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(process.env.APP_ORIGIN || request.url).origin;
}
