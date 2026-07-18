import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiTokens, user } from "../db/schema";
import { createTestDatabase } from "../db/test-db.server";
import { createApiToken, listApiTokens, resolveApiToken, revokeApiToken } from "./tokens.server";

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await testDb.db.insert(user).values({ id: "user-1", name: "User", email: "u@example.com", username: "user-one" });
});

afterAll(() => testDb.close());

describe("api tokens", () => {
  it("creates, resolves, lists, and revokes tokens without storing plaintext", async () => {
    const { token, summary } = await createApiToken("user-1", testDb.db);
    expect(token).toMatch(/^pc_/);
    expect(summary.prefix).toBe(token.slice(0, 11));

    const [stored] = await testDb.db.select().from(apiTokens);
    expect(stored.tokenHash).not.toContain(token.slice(3));
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const resolved = await resolveApiToken(token, testDb.db);
    expect(resolved).toMatchObject({ id: "user-1", username: "user-one" });
    const listed = await listApiTokens("user-1", testDb.db);
    expect(listed).toHaveLength(1);
    expect(listed[0].lastUsedAt).not.toBeNull();

    expect(await resolveApiToken("pc_not-a-real-token", testDb.db)).toBeNull();
    expect(await resolveApiToken("garbage", testDb.db)).toBeNull();

    expect(await revokeApiToken(summary.id, "someone-else", testDb.db)).toBe(false);
    expect(await revokeApiToken(summary.id, "user-1", testDb.db)).toBe(true);
    expect(await resolveApiToken(token, testDb.db)).toBeNull();
  });
});
