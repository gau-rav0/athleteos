// Test-only HTTP Auth/RPC provider. Never imported by the application.
// This exercises real SSR cookie handling. Database RLS is tested separately.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
const sessions = new Map();
const users = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: "one@synthetic.example",
    steps: 100,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: "two@synthetic.example",
    steps: 300,
  },
];
const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2025-01-01T00:00:00Z",
});
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function token(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: user.id,
      aud: "authenticated",
      role: "authenticated",
      exp: now + 3600,
      iat: now,
      iss: "http://127.0.0.1:3201/auth/v1",
    }),
    randomBytes(32).toString("base64url"),
  ].join(".");
  sessions.set(access, user);
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: randomBytes(32).toString("hex"),
    user: publicUser(user),
  };
}
createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3201"),
    send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
  if (url.pathname === "/health") return send(200, { ok: true });
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) return send(413, {});
  }
  let input;
  try {
    input = body ? JSON.parse(body) : {};
  } catch {
    return send(400, {});
  }
  if (url.pathname === "/auth/v1/token") {
    const user = users.find((u) => u.email === input.email);
    if (!user || input.password !== "demo-only")
      return send(400, {
        error: "invalid_grant",
        error_description: "Invalid synthetic login",
      });
    return send(200, token(user));
  }
  const bearer = (req.headers.authorization || "").replace(/^Bearer /, ""),
    user = sessions.get(bearer);
  if (!user)
    return send(401, { code: "bad_jwt", message: "Invalid synthetic session" });
  if (url.pathname === "/auth/v1/user") return send(200, publicUser(user));
  if (url.pathname === "/auth/v1/logout") {
    sessions.delete(bearer);
    return send(200, {});
  }
  if (url.pathname === "/rest/v1/rpc/refresh_web_facts")
    return send(200, { processed: 0, remaining: false });
  const now = new Date().toISOString(),
    date = now.slice(0, 10),
    start = date + "T00:00:00Z",
    end = date + "T23:59:00Z";
  if (url.pathname === "/rest/v1/rpc/web_facts_page")
    return send(
      200,
      input.p_offset === 0
        ? [
            {
              id: "synthetic-record-" + user.id,
              kind: "steps",
              provider: "health_connect",
              origin: "live",
              source: "synthetic.example",
              channel: "synthetic-watch",
              rank: 300,
              start,
              end,
              received: now,
              value: user.steps,
              samples: 1,
              min: null,
              max: null,
              sessions: [],
              hourly: [],
              supported: true,
              bodyFat: null,
            },
          ]
        : [],
    );
  if (url.pathname === "/rest/v1/rpc/web_inventory")
    return send(200, {
      inventory: [
        {
          provider: "health_connect",
          record_type: "steps",
          records: 1,
          observed_days: 1,
          first_at: start,
          last_at: start,
          received_at: now,
          historical_records: 0,
        },
      ],
      sync: null,
    });
  send(404, {});
}).listen(3201, "127.0.0.1");
