import { describe, it, expect } from "vitest";
import { boundedJson, BodyTooLarge, sameOrigin } from "@/lib/security";
describe("authentication request boundary", () => {
  it("rejects missing or foreign origins", () => {
    expect(
      sameOrigin(new Request("http://localhost:3200/api/auth/login")),
    ).toBe(false);
    expect(
      sameOrigin(
        new Request("http://localhost:3200/api/auth/login", {
          headers: { Origin: "https://synthetic.example" },
        }),
      ),
    ).toBe(false);
  });
  it("parses bounded JSON without content-length", async () => {
    expect(
      await boundedJson(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ synthetic: true }),
        }),
      ),
    ).toEqual({ synthetic: true });
  });
  it("bounds bytes even with missing or misleading content-length", async () => {
    for (const headers of [
      new Headers(),
      new Headers({ "content-length": "1" }),
    ]) {
      await expect(
        boundedJson(
          new Request("http://localhost", {
            method: "POST",
            headers,
            body: JSON.stringify({ synthetic: "x".repeat(5000) }),
          }),
        ),
      ).rejects.toBeInstanceOf(BodyTooLarge);
    }
  });
  it("rejects malformed JSON and UTF-8 without returning contents", async () => {
    await expect(
      boundedJson(
        new Request("http://localhost", { method: "POST", body: "{" }),
      ),
    ).rejects.toThrow();
    await expect(
      boundedJson(
        new Request("http://localhost", {
          method: "POST",
          body: new Uint8Array([255]),
        }),
      ),
    ).rejects.toThrow();
  });
});
