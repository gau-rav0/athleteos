import { beforeEach, expect, test, vi } from "vitest";
import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  server: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: mocks.server }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { requireUser } from "@/lib/supabase/auth";
import { isInvalidSession } from "@/lib/supabase/session-error";
import { GET } from "@/app/api/dashboard/route";
import { POST as projection } from "@/app/api/dashboard/projection/route";
import { POST as inventory } from "@/app/api/dashboard/inventory/route";

const invalid = [
  new AuthSessionMissingError(),
  new AuthInvalidJwtError("synthetic private details"),
  new AuthApiError("synthetic private details", 401, undefined),
  new AuthApiError("synthetic private details", 403, "user_banned"),
  ...[
    "session_expired",
    "session_not_found",
    "refresh_token_not_found",
    "refresh_token_already_used",
    "user_not_found",
  ].map((code) => new AuthApiError("synthetic private details", 400, code)),
];
const unavailable = [
  new AuthRetryableFetchError("synthetic private details", 0),
  new AuthRetryableFetchError("synthetic private details", 503),
  new AuthUnknownError("synthetic private details", new Error("private cause")),
  ...[408, 429, 500, 502, 503, 504, 530].map(
    (status) =>
      new AuthApiError(
        "synthetic private details",
        status,
        "unexpected_failure",
      ),
  ),
  new AuthApiError("synthetic private details", 400, "unexpected_failure"),
  new AuthApiError("synthetic private details", 503, "bad_jwt"),
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "http://localhost:3100");
  mocks.server.mockResolvedValue({ auth: { getUser: mocks.auth } });
  mocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

test("validated Auth identity is required and returned with the same client", async () => {
  const user = { id: "synthetic-owner" };
  mocks.auth.mockResolvedValue({ data: { user }, error: null });
  const result = await requireUser();
  expect(result.user).toBe(user);
  expect(result.client).toBe(await mocks.server.mock.results[0].value);
  expect(mocks.redirect).not.toHaveBeenCalled();
});

test.each(invalid)(
  "invalid returned session redirects without swallowing Next control flow: %s",
  async (error) => {
    expect(isInvalidSession(error)).toBe(true);
    // An error always overrides even a stray user object.
    mocks.auth.mockResolvedValue({
      data: { user: { id: "synthetic-owner" } },
      error,
    });
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login");
  },
);

test.each(unavailable)(
  "returned service failure never redirects or authenticates: %s",
  async (error) => {
    expect(isInvalidSession(error)).toBe(false);
    mocks.auth.mockResolvedValue({
      data: { user: { id: "synthetic-owner" } },
      error,
    });
    await expect(requireUser()).rejects.toThrow(/^AUTH_SERVICE_UNAVAILABLE$/);
    expect(mocks.redirect).not.toHaveBeenCalled();
  },
);

test("missing user redirects, while thrown errors remain sanitized and recovery revalidates", async () => {
  mocks.auth.mockResolvedValueOnce({ data: { user: null }, error: null });
  await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
  mocks.redirect.mockClear();
  for (const failure of [
    new TypeError("private endpoint"),
    new DOMException("private endpoint", "AbortError"),
    "private failure",
    ...unavailable,
  ]) {
    mocks.auth.mockRejectedValueOnce(failure);
    await expect(requireUser()).rejects.toThrow(/^AUTH_SERVICE_UNAVAILABLE$/);
  }
  expect(mocks.redirect).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValueOnce({
    data: { user: { id: "synthetic-new-owner" } },
    error: null,
  });
  expect((await requireUser()).user.id).toBe("synthetic-new-owner");
  mocks.auth.mockRejectedValueOnce(new AuthSessionMissingError());
  await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT");
});

const routes = [
  ["read", GET, undefined],
  ["projection", projection, { days: 7, timezone: "UTC" }],
  ["inventory", inventory, { timezone: "UTC" }],
] as const;
test.each(routes)(
  "%s API distinguishes session failures from outages without serving data",
  async (_name, handler, body) => {
    const request = () =>
      new Request(
        "http://localhost:3100/api/dashboard",
        body === undefined
          ? undefined
          : {
              method: "POST",
              headers: {
                Origin: "http://localhost:3100",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            },
      );
    for (const error of [...invalid, ...unavailable]) {
      mocks.auth.mockResolvedValueOnce({
        data: { user: { id: "synthetic-owner" } },
        error,
      });
      const response = await handler(request());
      const session = isInvalidSession(error);
      expect(response.status).toBe(session ? 401 : 503);
      expect(await response.json()).toEqual({
        error: session ? "AUTH_REQUIRED" : "AUTH_SERVICE_UNAVAILABLE",
      });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect(response.headers.get("Vary")).toBe("Cookie");
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
    for (const error of [
      ...invalid,
      ...unavailable,
      new TypeError("private transport"),
    ]) {
      mocks.auth.mockRejectedValueOnce(error);
      const response = await handler(request());
      const session = isInvalidSession(error);
      expect(response.status).toBe(session ? 401 : 503);
      expect(await response.json()).toEqual({
        error: session ? "AUTH_REQUIRED" : "AUTH_SERVICE_UNAVAILABLE",
      });
    }
  },
);
