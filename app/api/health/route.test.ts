import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { GET } from "./route";

const previousDatabaseUrl = process.env.DATABASE_URL;

beforeAll(() => {
  delete process.env.DATABASE_URL;
});

afterAll(() => {
  if (previousDatabaseUrl !== undefined) process.env.DATABASE_URL = previousDatabaseUrl;
});

describe.sequential("GET /api/health", () => {
  it("reports an engine-only instance (no database configured) as ready", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "ready",
      engine: "partcanvas-typescript",
      database: { driver: "postgres", configured: false },
    });
  });

  it("uses database reachability as the readiness signal when configured", async () => {
    const testDb = await createTestDatabase();
    setDatabaseForTests(testDb.db);
    try {
      const healthy = await GET();
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toMatchObject({
        status: "ready",
        database: { driver: "postgres", configured: true, reachable: true },
      });

      await testDb.close();
      const unhealthy = await GET();
      expect(unhealthy.status).toBe(503);
      expect(await unhealthy.json()).toMatchObject({
        status: "unavailable",
        database: { configured: true, reachable: false },
      });
    } finally {
      setDatabaseForTests(null);
    }
  });
});
