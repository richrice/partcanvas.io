import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, rateLimitResponse, resetRateLimitsForTests } from "./rate-limit.server";

const RULE = { capacity: 3, refillPerSecond: 1 };

beforeEach(() => resetRateLimitsForTests());

describe("checkRateLimit", () => {
  it("allows bursts up to capacity, then denies with a retry hint", () => {
    const start = 1_000_000;
    for (let index = 0; index < 3; index += 1) {
      expect(checkRateLimit("k", RULE, start).allowed).toBe(true);
    }
    const denied = checkRateLimit("k", RULE, start);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("refills over time", () => {
    const start = 1_000_000;
    for (let index = 0; index < 3; index += 1) checkRateLimit("k", RULE, start);
    expect(checkRateLimit("k", RULE, start).allowed).toBe(false);
    expect(checkRateLimit("k", RULE, start + 1_500).allowed).toBe(true);
    // Refill never exceeds capacity.
    for (let index = 0; index < 3; index += 1) checkRateLimit("k", RULE, start + 100_000);
    expect(checkRateLimit("k", RULE, start + 100_000).allowed).toBe(false);
  });

  it("keeps keys independent", () => {
    const start = 1_000_000;
    for (let index = 0; index < 3; index += 1) checkRateLimit("a", RULE, start);
    expect(checkRateLimit("a", RULE, start).allowed).toBe(false);
    expect(checkRateLimit("b", RULE, start).allowed).toBe(true);
  });
});

describe("helpers", () => {
  it("extracts the client ip from proxy headers", () => {
    expect(clientIp(new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x/", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x/"))).toBe("unknown");
  });

  it("builds a 429 response with retry-after", async () => {
    const response = rateLimitResponse({ allowed: false, retryAfterSeconds: 7 }, { "access-control-allow-origin": "*" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect((await response.json()).error).toMatch(/rate limit/i);
  });
});
