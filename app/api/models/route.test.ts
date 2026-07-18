import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { revisions } from "@/lib/db/schema";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { saveRevision } from "@/lib/models/revisions.server";
import { saveHostedModel } from "@/lib/models/store.server";
import { POST } from "./route";
import { GET } from "./[id]/route";

// Reads run Postgres-first (PGlite here) with filesystem fallback (D14);
// anonymous POST publishing is retired (D6).
let storageDirectory = "";
const previousStorage = process.env.PARTCANVAS_DATA_DIR;
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  storageDirectory = await mkdtemp(path.join(os.tmpdir(), "partcanvas-models-"));
  process.env.PARTCANVAS_DATA_DIR = storageDirectory;
  testDb = await createTestDatabase();
  setDatabaseForTests(testDb.db);
});

afterAll(async () => {
  setDatabaseForTests(null);
  await testDb.close();
  if (previousStorage === undefined) delete process.env.PARTCANVAS_DATA_DIR;
  else process.env.PARTCANVAS_DATA_DIR = previousStorage;
  await rm(storageDirectory, { recursive: true, force: true });
});

describe("hosted model API", () => {
  it("rejects anonymous publishing with a pointer to sign-in (D6)", async () => {
    const response = await POST();
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const payload = await response.json();
    expect(payload.error).toMatch(/sign in/i);
    expect(payload.error).toMatch(/token/i);
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

  it("falls back to the legacy filesystem store for records not yet in Postgres", async () => {
    const { model } = await saveHostedModel({ name: "Legacy record", source: "cube([4, 4, 4]);" });
    const response = await GET(new Request(`http://localhost/api/models/${model.id}`), { params: Promise.resolve({ id: model.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).model.id).toBe(model.id);
    const rows = await testDb.db.select({ id: revisions.id }).from(revisions).where(eq(revisions.id, model.id));
    expect(rows).toHaveLength(0);
  });
});
