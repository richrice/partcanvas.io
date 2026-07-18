import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { setDatabaseForTests } from "../db/client.server";
import { session, user } from "../db/schema";
import { createTestDatabase } from "../db/test-db.server";
import { getSessionUser, setSessionUserForTests } from "./session.server";

const SECRET = "test-secret-for-vitest-only";
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
const previousSecret = process.env.BETTER_AUTH_SECRET;
const previousUrl = process.env.BETTER_AUTH_URL;

// Better Auth session cookies are `encodeURIComponent(token + "." + base64(HMAC-SHA256(secret, token)))`.
function sessionCookie(token: string): string {
  const signature = createHmac("sha256", SECRET).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = SECRET;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values({
    id: "user-1",
    name: "Test Author",
    email: "author@example.com",
    emailVerified: true,
    username: "test-author",
    bio: "I make brackets.",
  });
  await testDb.db.insert(session).values({
    id: "session-1",
    token: "session-token-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 86_400_000),
  });
});

afterAll(async () => {
  setDatabaseForTests(null);
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;
  if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousUrl;
  await testDb.close();
});

describe("getSessionUser", () => {
  it("resolves a signed session cookie to the user with additional fields", async () => {
    const resolved = await getSessionUser(new Request("http://localhost:3000/api/app/models", {
      headers: { cookie: sessionCookie("session-token-1") },
    }));
    expect(resolved).toMatchObject({
      id: "user-1",
      name: "Test Author",
      email: "author@example.com",
      username: "test-author",
      bio: "I make brackets.",
    });
  });

  it("returns null without a cookie and for tampered tokens", async () => {
    expect(await getSessionUser(new Request("http://localhost:3000/api/app/models"))).toBeNull();
    const forged = `better-auth.session_token=${encodeURIComponent("session-token-1.AAAA")}`;
    expect(await getSessionUser(new Request("http://localhost:3000/api/app/models", { headers: { cookie: forged } }))).toBeNull();
  });

  it("honors the test stub", async () => {
    setSessionUserForTests({ id: "stub", name: "Stub", email: "stub@example.com", username: null, bio: null });
    try {
      const resolved = await getSessionUser(new Request("http://localhost:3000/api/app/models"));
      expect(resolved?.id).toBe("stub");
    } finally {
      setSessionUserForTests(undefined);
    }
    setSessionUserForTests(null);
    try {
      expect(await getSessionUser(new Request("http://localhost:3000/api/app/models", { headers: { cookie: sessionCookie("session-token-1") } }))).toBeNull();
    } finally {
      setSessionUserForTests(undefined);
    }
  });
});
