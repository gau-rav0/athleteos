import "server-only";

export const SERVER_HTTP_TIMEOUT_MS = 10000;

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
  try {
    return await fetch(input, { ...init, cache: "no-store", signal });
  } catch {
    // Network exception details can include endpoints; no original exception or
    // request options escape this transport boundary or enter application logs.
    throw new Error("SERVER_TRANSPORT_UNAVAILABLE");
  }
}
