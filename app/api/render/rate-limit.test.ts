import { beforeAll, describe, expect, it } from "vitest";
import { COMPILE_RULE, resetRateLimitsForTests } from "@/lib/api/rate-limit.server";
import { POST } from "./route";

// Route-level guard: the render endpoint applies the per-IP compile bucket.
function renderRequest(ip: string) {
  return new Request("http://localhost/api/render", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ source: "cube(1);", format: "stl", summary: true }),
  });
}

beforeAll(() => resetRateLimitsForTests());

describe("render rate limiting", () => {
  it("returns 429 with retry-after once the per-IP burst is exhausted", async () => {
    for (let index = 0; index < COMPILE_RULE.capacity; index += 1) {
      expect((await POST(renderRequest("9.9.9.9"))).status).toBe(200);
    }
    const limited = await POST(renderRequest("9.9.9.9"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(limited.headers.get("access-control-allow-origin")).toBe("*");
    // A different client is unaffected.
    expect((await POST(renderRequest("8.8.8.8"))).status).toBe(200);
  });
});
