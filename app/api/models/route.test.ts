import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiToken } from "@/lib/auth/tokens.server";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { user } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { listModelVersions } from "@/lib/models/models.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { POST } from "./route";
import { GET } from "./[id]/route";

// Revisions live in Postgres (PGlite here); anonymous POST publishing is
// retired (D6), bearer-token publishing is the programmatic path (P5.2).
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
});

afterAll(async () => {
  setDatabaseForTests(null);
  await testDb.close();
});

function tokenPublish(body: unknown, token?: string) {
  return POST(new Request("http://localhost/api/models", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }));
}

describe("hosted model API", () => {
  it("rejects anonymous publishing with a pointer to sign-in (D6)", async () => {
    const response = await tokenPublish({ name: "X", source: "cube(4);" });
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const payload = await response.json();
    expect(payload.error).toMatch(/sign in/i);
    expect(payload.error).toMatch(/token/i);
    expect((await tokenPublish({ name: "X", source: "cube(4);" }, "pc_bogus")).status).toBe(401);
  });

  it("publishes with a bearer token: new model, then a new version of it", async () => {
    await testDb.db.insert(user).values({ id: "token-user", name: "Token User", email: "t@example.com", username: "token-user" });
    const { token } = await createApiToken("token-user", testDb.db);

    const created = await tokenPublish({ name: "CLI widget", source: "cube([4, 4, 4]);", tags: ["cli"] }, token);
    expect(created.status).toBe(201);
    const createdPayload = await created.json();
    expect(createdPayload.url).toBe("/u/token-user/cli-widget");
    expect(createdPayload.model.ownerId).toBe("token-user");

    const updated = await tokenPublish({ name: "CLI widget", source: "cube([5, 5, 5]);", modelId: createdPayload.model.id }, token);
    expect(updated.status).toBe(201);
    const updatedPayload = await updated.json();
    expect(updatedPayload.version).toBe(2);
    expect((await listModelVersions(createdPayload.model.id, testDb.db)).map((entry) => entry.version)).toEqual([2, 1]);

    // Another account's token cannot push versions to it.
    await testDb.db.insert(user).values({ id: "intruder", name: "Intruder", email: "i@example.com", username: "intruder" });
    const { token: intruderToken } = await createApiToken("intruder", testDb.db);
    expect((await tokenPublish({ name: "CLI widget", source: "cube([6, 6, 6]);", modelId: createdPayload.model.id }, intruderToken)).status).toBe(403);
  });

  it("serves stored revisions with etag and conditional requests", async () => {
    const { record } = await saveRevision({
      name: "Parametric label",
      source: `label = "PARTCANVAS"; // Label text\nlinear_extrude(2) text(label, size=12);`,
      parameters: { label: "HELLO" },
    }, testDb.db);

    const retrieved = await GET(new Request(`http://localhost/api/models/${record.id}`), { params: Promise.resolve({ id: record.id }) });
    expect(retrieved.status).toBe(200);
    expect(retrieved.headers.get("etag")).toBe(`"${record.id}"`);
    expect(retrieved.headers.get("access-control-allow-origin")).toBe("*");
    expect((await retrieved.json()).model.createdAt).toBe(record.createdAt);

    const unchanged = await GET(new Request(`http://localhost/api/models/${record.id}`, {
      headers: { "if-none-match": `"${record.id}"` },
    }), { params: Promise.resolve({ id: record.id }) });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
  });

  it("returns 404 for unknown IDs", async () => {
    const missing = await GET(new Request("http://localhost/api/models/aaaaaaaaaaaaaaaaaaaaaaaa"), { params: Promise.resolve({ id: "aaaaaaaaaaaaaaaaaaaaaaaa" }) });
    expect(missing.status).toBe(404);
  });
});
