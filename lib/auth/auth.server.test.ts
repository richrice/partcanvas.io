import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verification } from "../db/schema";
import { createTestDatabase } from "../db/test-db.server";
import { createAuth, type Auth } from "./auth.server";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let auth: Auth;
const previousEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [key, value] of Object.entries({
    BETTER_AUTH_SECRET: "test-secret-for-vitest-only",
    BETTER_AUTH_URL: "http://localhost:3000",
    GITHUB_CLIENT_ID: "test-github-client-id",
    GITHUB_CLIENT_SECRET: "test-github-client-secret",
  })) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  testDb = await createTestDatabase();
  auth = createAuth(testDb.db);
});

afterAll(async () => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await testDb.close();
});

describe("better auth wiring", () => {
  it("serves get-session with no cookie as a null session", async () => {
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/get-session"));
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("starts a GitHub social sign-in and persists OAuth state through the drizzle adapter", async () => {
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ provider: "github", callbackURL: "/" }),
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.url).toContain("github.com/login/oauth/authorize");
    expect(payload.url).toContain("test-github-client-id");

    const rows = await testDb.db.select({ id: verification.id }).from(verification);
    expect(rows.length).toBeGreaterThan(0);
  });
});
