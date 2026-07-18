import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setSessionUserForTests, type SessionUser } from "@/lib/auth/session.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { POST } from "./route";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

function stubUser(id: string, username: string | null = null): SessionUser {
  return { id, name: "Someone", email: `${id}@example.com`, username, bio: null };
}

function claimRequest(body: unknown) {
  return new Request("http://localhost/api/app/username", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
  await testDb.db.insert(user).values([
    { id: "user-a", name: "User A", email: "a@example.com" },
    { id: "user-b", name: "User B", email: "b@example.com" },
  ]);
});

afterAll(async () => {
  setSessionUserForTests(undefined);
  setDatabaseForTests(null);
  await testDb.close();
});

describe("POST /api/app/username", () => {
  it("requires a session", async () => {
    setSessionUserForTests(null);
    const response = await POST(claimRequest({ username: "someone" }));
    expect(response.status).toBe(401);
  });

  it("claims a normalized username once", async () => {
    setSessionUserForTests(stubUser("user-a"));
    const response = await POST(claimRequest({ username: "  Gear-Smith " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: "gear-smith" });
    const [row] = await testDb.db.select({ username: user.username }).from(user).where(eq(user.id, "user-a"));
    expect(row.username).toBe("gear-smith");

    // Second claim for the same account: session stub still reports null
    // username, so the guarded UPDATE is what must refuse it.
    const again = await POST(claimRequest({ username: "other-name" }));
    expect(again.status).toBe(409);
  });

  it("rejects invalid, reserved, and malformed input", async () => {
    setSessionUserForTests(stubUser("user-b"));
    expect((await POST(claimRequest({ username: "No Spaces!" }))).status).toBe(422);
    expect((await POST(claimRequest({ username: "admin" }))).status).toBe(422);
    expect((await POST(claimRequest("{not json"))).status).toBe(400);
  });

  it("returns 409 when the name is taken and refuses users who already chose", async () => {
    setSessionUserForTests(stubUser("user-b"));
    const taken = await POST(claimRequest({ username: "gear-smith" }));
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toMatch(/taken/);

    setSessionUserForTests(stubUser("user-b", "already-chosen"));
    expect((await POST(claimRequest({ username: "fresh-name" }))).status).toBe(409);
  });
});
