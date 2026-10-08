import {
  AuthRetryableFetchError,
  AuthSessionMissingError,
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getUserSafely(client: Pick<SupabaseClient, "auth">) {
  return client.auth.getUser().catch((error: unknown) => ({
    data: { user: null },
    // Normalize thrown errors without retaining endpoints, tokens or causes.
    error: isInvalidSession(error)
      ? new AuthSessionMissingError()
      : new AuthRetryableFetchError("AUTH_SERVICE_UNAVAILABLE", 0),
  }));
}

const invalidSessionCodes = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_not_found",
  "user_banned",
]);

// Only positive evidence of an invalid session may trigger login/401. Unknown
// failures remain unavailable: neither a validated identity nor a logout.
export function isInvalidSession(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return false;
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthError(error)) return false;
  if (
    error.status === 0 ||
    error.status === 408 ||
    error.status === 429 ||
    (error.status !== undefined && error.status >= 500)
  )
    return false;
  return (
    error.status === 401 ||
    error.status === 403 ||
    (error.code !== undefined && invalidSessionCodes.has(error.code))
  );
}
