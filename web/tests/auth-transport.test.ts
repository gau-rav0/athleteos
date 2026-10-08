import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthUnknownError,
  createClient,
} from "@supabase/supabase-js";
import type { CookieOptions } from "@supabase/ssr";

const mocks = vi.hoisted(() => ({ create: vi.fn(), auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
import {
  boundedServerFetch,
  SERVER_HTTP_TIMEOUT_MS,
} from "@/lib/supabase/transport";
import { proxy } from "@/proxy";

type Options = {
  cookies: {
    setAll: (
      values: { name: string; value: string; options: CookieOptions }[],
    ) => void;
  };
  global: { fetch: typeof fetch };
};
let options: Options;
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://synthetic.example");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-public");
  mocks.auth.mockReset().mockResolvedValue({ error: null });
  mocks.create
    .mockReset()
    .mockImplementation((_url, _key, supplied: Options) => {
      options = supplied;
      return { auth: { getUser: mocks.auth } };
    });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("Auth failures are normalized before SDK session teardown, while RPC errors and invalid sessions stay intact", async () => {
  for (const [status, body] of [
    [408, { code: "request_timeout" }],
    [429, { code: "over_request_rate_limit" }],
    [400, { code: "unexpected_failure" }],
    [505, { code: "unexpected_failure" }],
    [503, { code: "bad_jwt" }],
    [400, "invalid json"],
    [400, "x".repeat(20000)],
  ] as const) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status,
        }),
      ),
    );
    await expect(
      boundedServerFetch(
        "https://synthetic.example/auth/v1/token?grant_type=refresh_token",
      ),
    ).rejects.toThrow(/^SERVER_TRANSPORT_UNAVAILABLE$/);
  }
  for (const url of [
    "https://synthetic.example/auth/v1/token?grant_type=refresh_token",
    "https://synthetic.example/rest/v1/rpc/synthetic",
  ]) {
    const response = new Response(
      JSON.stringify({ error_code: "refresh_token_not_found" }),
      { status: 400 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await boundedServerFetch(url)).toBe(response);
  }
  for (const url of [
    "https://synthetic.example/rest/v1/rpc/synthetic",
    "https://another.example/auth/v1/token?grant_type=refresh_token",
    "https://synthetic.example/auth/v1/logout",
    "https://synthetic.example/auth/v1/token?grant_type=password",
  ]) {
    const response = new Response("unavailable", { status: 429 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect(await boundedServerFetch(url)).toBe(response);
  }
  const passwordFailure = new Response(
    JSON.stringify({ error_code: "invalid_credentials" }),
    { status: 400 },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(passwordFailure));
  expect(
    await boundedServerFetch(
      "https://synthetic.example/auth/v1/token?grant_type=password",
    ),
  ).toBe(passwordFailure);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  await expect(
    boundedServerFetch(
      "https://synthetic.example/auth/v1/token?grant_type=refresh_token",
    ),
  ).rejects.toThrow(/^SERVER_TRANSPORT_UNAVAILABLE$/);
});

test("installed SSR SDK preserves expired refresh cookies through Auth outages and recovers with validated identity", async () => {
  vi.useFakeTimers();
  const { createServerClient: installedServer } =
    await vi.importActual<typeof import("@supabase/ssr")>("@supabase/ssr");
  const session = {
    access_token: "synthetic-expired-access",
    refresh_token: "synthetic-refresh",
    expires_at: Math.floor(Date.now() / 1000) - 60,
    expires_in: 3600,
    user: { id: "00000000-0000-4000-8000-000000000001" },
    token_type: "bearer",
  };
  const jar = new Map([["synthetic-session", JSON.stringify(session)]]);
  const writes: { name: string; value: string }[] = [];
  const client = () =>
    installedServer("https://synthetic.example", "synthetic-public", {
      cookieEncoding: "raw",
      cookieOptions: { name: "synthetic-session" },
      global: { fetch: boundedServerFetch },
      cookies: {
        getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
        setAll: (values) => {
          writes.push(...values);
          for (const { name, value } of values) {
            if (value) jar.set(name, value);
            else jar.delete(name);
          }
        },
      },
    });
  for (const response of [
    () =>
      new Response(JSON.stringify({ error_code: "over_request_rate_limit" }), {
        status: 429,
      }),
    () =>
      new Response(JSON.stringify({ error_code: "unexpected_failure" }), {
        status: 400,
      }),
    () => new Response("malformed", { status: 400 }),
    () => new Response("{}"),
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response));
    const pending = client().auth.getUser();
    await vi.advanceTimersByTimeAsync(35000);
    const result = await pending;
    expect(result.data.user).toBeNull();
    expect(result.error).toBeInstanceOf(AuthRetryableFetchError);
    expect(writes).toEqual([]);
    expect(jar.get("synthetic-session")).toBe(JSON.stringify(session));
  }
  const refreshed = {
    ...session,
    access_token: "synthetic-new-access",
    refresh_token: "synthetic-rotated-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  const fetcher = vi
    .fn()
    .mockImplementation(
      (input: string) =>
        new Response(
          JSON.stringify(input.includes("/token?") ? refreshed : session.user),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
  vi.stubGlobal("fetch", fetcher);
  const recovered = await client().auth.getUser();
  expect(recovered.error).toBeNull();
  expect(recovered.data.user?.id).toBe(session.user.id);
  expect(
    fetcher.mock.calls.some(([url]) => String(url).endsWith("/auth/v1/user")),
  ).toBe(true);
  expect(
    writes.some(({ value }) => value.includes("synthetic-rotated-refresh")),
  ).toBe(true);
  jar.set("synthetic-session", JSON.stringify(session));
  writes.length = 0;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        () =>
          new Response(
            JSON.stringify({ error_code: "refresh_token_not_found" }),
            { status: 400 },
          ),
      ),
  );
  const invalid = await client().auth.getUser();
  expect(invalid.data.user).toBeNull();
  expect(invalid.error?.code).toBe("refresh_token_not_found");
  expect(writes.some(({ value }) => value === "")).toBe(true);
  expect(jar.has("synthetic-session")).toBe(false);
  jar.set("synthetic-session", JSON.stringify(refreshed));
  writes.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => new Response("{}")),
  );
  const malformedUser = await client().auth.getUser();
  expect(malformedUser.data.user).toBeNull();
  expect(malformedUser.error).toBeInstanceOf(AuthRetryableFetchError);
  expect(writes).toEqual([]);
  expect(jar.get("synthetic-session")).toBe(JSON.stringify(refreshed));
});

test("Auth transport adds a 10s deadline and disables request caching", async () => {
  const deadline = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(deadline.signal);
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('{"id":"synthetic-owner"}'));
  vi.stubGlobal("fetch", fetcher);
  await boundedServerFetch("https://synthetic.example/auth/v1/user", {
    cache: "force-cache",
  });
  expect(timeout).toHaveBeenCalledWith(SERVER_HTTP_TIMEOUT_MS);
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    cache: "no-store",
    signal: deadline.signal,
  });
});

test("explicit RPC deadline is preserved and proxy request cancellation is combined", async () => {
  const rpc = new AbortController(),
    request = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  await boundedServerFetch(
    "https://synthetic.example/rest/v1/rpc/synthetic",
    { signal: rpc.signal },
    request.signal,
  );
  expect(timeout).not.toHaveBeenCalled();
  const effective = fetcher.mock.calls[0][1].signal as AbortSignal;
  expect(effective.aborted).toBe(false);
  request.abort();
  expect(effective.aborted).toBe(true);
});

test("Request-carried cancellation is preserved", async () => {
  const caller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const request = new Request("https://synthetic.example", {
    signal: caller.signal,
  });
  const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  await boundedServerFetch(request);
  expect(timeout).toHaveBeenCalledWith(SERVER_HTTP_TIMEOUT_MS);
  const effective = fetcher.mock.calls[0][1].signal as AbortSignal;
  caller.abort();
  expect(effective.aborted).toBe(true);
});

test("plain Request with its implicit signal still receives a transport deadline", async () => {
  const deadline = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(deadline.signal);
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response('{"id":"synthetic-owner"}'));
  vi.stubGlobal("fetch", fetcher);
  await boundedServerFetch(
    new Request("https://synthetic.example/auth/v1/user"),
  );
  expect(timeout).toHaveBeenCalledWith(SERVER_HTTP_TIMEOUT_MS);
  const effective = fetcher.mock.calls[0][1].signal as AbortSignal;
  deadline.abort();
  expect(effective.aborted).toBe(true);
});

test("stalled Auth fetch aborts and native failure details are redacted", async () => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new Error("private synthetic endpoint details")),
          );
        }),
    ),
  );
  const pending = boundedServerFetch("https://synthetic.example/auth/v1/user");
  deadline.abort();
  await expect(pending).rejects.toThrow("SERVER_TRANSPORT_UNAVAILABLE");
});

test("installed Supabase Auth getUser uses the bounded default transport", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: "00000000-0000-4000-8000-000000000001" }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
  );
  const client = createClient("https://synthetic.example", "synthetic-public", {
    global: { fetch: boundedServerFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const result = await client.auth.getUser("synthetic-short");
  expect(result.error).toBeNull();
  expect(timeout).toHaveBeenCalledWith(10000);
});

test("proxy preserves all cookie refresh batches and latest cookie revisions", async () => {
  mocks.auth.mockImplementation(async () => {
    options.cookies.setAll([
      {
        name: "synthetic-a",
        value: "first",
        options: { httpOnly: true, path: "/" },
      },
    ]);
    options.cookies.setAll([
      {
        name: "synthetic-b",
        value: "second",
        options: { httpOnly: true, path: "/" },
      },
      {
        name: "synthetic-a",
        value: "updated",
        options: { httpOnly: true, path: "/" },
      },
    ]);
    return { error: null };
  });
  const request = new NextRequest("https://synthetic.example/today");
  const response = await proxy(request);
  expect(response.cookies.get("synthetic-a")?.value).toBe("updated");
  expect(response.cookies.get("synthetic-b")?.value).toBe("second");
  expect(request.cookies.get("synthetic-a")?.value).toBe("updated");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});

test("proxy fails closed with generic private errors on Auth transport failure", async () => {
  for (const thrown of [true, false]) {
    mocks.auth.mockImplementation(async () => {
      if (thrown) throw new Error("private synthetic transport details");
      return {
        error: new AuthRetryableFetchError("private synthetic details", 0),
      };
    });
    const response = await proxy(
      new NextRequest("https://synthetic.example/today"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AUTH_SERVICE_UNAVAILABLE",
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  }
});

test("proxy treats throttling and unknown service failures as outages and preserves refresh cookies", async () => {
  for (const error of [
    new AuthApiError(
      "synthetic private details",
      429,
      "over_request_rate_limit",
    ),
    new AuthApiError("synthetic private details", 500, "unexpected_failure"),
    new AuthUnknownError(
      "synthetic private details",
      new Error("private cause"),
    ),
  ]) {
    mocks.auth.mockImplementation(async () => {
      options.cookies.setAll([
        {
          name: "synthetic-refresh",
          value: "rotated",
          options: { httpOnly: true },
        },
      ]);
      return { error };
    });
    const response = await proxy(
      new NextRequest("https://synthetic.example/today"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AUTH_SERVICE_UNAVAILABLE",
    });
    expect(response.cookies.get("synthetic-refresh")?.value).toBe("rotated");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
});
