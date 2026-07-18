import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { HostedModel } from "../models/types";
import { revisions } from "./schema";
import { createTestDatabase } from "./test-db.server";

const record: HostedModel = {
  version: 1,
  id: "a".repeat(24),
  createdAt: "2026-07-18T00:00:00.000Z",
  name: "Smoke cube",
  description: "",
  source: "cube(10);",
  files: {},
  parameters: {},
  tags: ["test"],
  parameterSchema: [],
  metrics: { bounds: null, dimensions: null, volume: null, area: null, triangles: 12, compileMs: 1 },
};

describe("test database harness", () => {
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(() => testDb.close());

  it("applies migrations and roundtrips a revision row", async () => {
    await testDb.db.insert(revisions).values({ id: record.id, record });
    const [row] = await testDb.db.select().from(revisions).where(eq(revisions.id, record.id));
    expect(row).toBeDefined();
    expect(row.record).toEqual(record);
    expect(row.thumbnail).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });
});
