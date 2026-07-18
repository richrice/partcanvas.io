import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

// D5 guard: permissive CORS stays scoped to the public compute/read API and
// never reaches cookie-authenticated surfaces (/api/auth/*, /api/app/*).

// Mirrors Next's path matching for the source syntax used in this config:
// literal paths plus a single trailing `/:name*` (zero or more segments).
function sourceToRegExp(source: string): RegExp {
  const pattern = source.replace(/\/:[A-Za-z0-9_]+\*$/, "(?:/.*)?");
  return new RegExp(`^${pattern}$`);
}

async function corsAllowedPaths(): Promise<RegExp[]> {
  const entries = await nextConfig.headers!();
  return entries
    .filter((entry) => entry.headers.some((header) => header.key.toLowerCase() === "access-control-allow-origin"))
    .map((entry) => sourceToRegExp(entry.source));
}

describe("CORS scope (D5)", () => {
  it("keeps permissive CORS on the public compute/read endpoints", async () => {
    const allowed = await corsAllowedPaths();
    for (const path of [
      "/api/render",
      "/api/parameters",
      "/api/models",
      "/api/models/abcdef0123456789abcdef01",
      "/api/models/abcdef0123456789abcdef01/thumbnail",
      "/api/health",
      "/api/capabilities",
    ]) {
      expect(allowed.some((regex) => regex.test(path)), `${path} should have permissive CORS`).toBe(true);
    }
  });

  it("never applies permissive CORS to cookie-authenticated endpoints", async () => {
    const allowed = await corsAllowedPaths();
    for (const path of [
      "/api/auth/get-session",
      "/api/auth/sign-in/social",
      "/api/auth/callback/github",
      "/api/app/models",
      "/api/app/models/some-id/like",
    ]) {
      expect(allowed.some((regex) => regex.test(path)), `${path} must not have permissive CORS`).toBe(false);
    }
  });
});
