import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setDatabaseForTests } from "@/lib/db/client.server";
import { createTestDatabase } from "@/lib/db/test-db.server";
import { GET } from "./route";

let testDirectory = "";
const previousStorage = process.env.PARTCANVAS_DATA_DIR;
const previousDatabaseUrl = process.env.DATABASE_URL;

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  testDirectory = await mkdtemp(path.join(os.tmpdir(), "partcanvas-health-"));
});

afterAll(async () => {
  if (previousStorage === undefined) delete process.env.PARTCANVAS_DATA_DIR;
  else process.env.PARTCANVAS_DATA_DIR = previousStorage;
  if (previousDatabaseUrl !== undefined) process.env.DATABASE_URL = previousDatabaseUrl;
  await rm(testDirectory, { recursive: true, force: true });
});

describe.sequential("GET /api/health", () => {
  it("reports a writable configured model store as ready", async () => {
    process.env.PARTCANVAS_DATA_DIR = path.join(testDirectory, "models");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "ready",
      engine: "partcanvas-typescript",
      storage: { driver: "filesystem", persistent: true, writable: true },
      database: { driver: "postgres", configured: false },
    });
  });

  it("returns 503 when the configured storage path cannot be a directory", async () => {
    const file = path.join(testDirectory, "not-a-directory");
    await writeFile(file, "occupied");
    process.env.PARTCANVAS_DATA_DIR = file;
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: "unavailable",
      storage: { persistent: true, writable: false },
    });
  });

  it("uses database reachability as the readiness signal when configured", async () => {
    process.env.PARTCANVAS_DATA_DIR = path.join(testDirectory, "models");
    const testDb = await createTestDatabase();
    setDatabaseForTests(testDb.db);
    try {
      const healthy = await GET();
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toMatchObject({
        status: "ready",
        database: { driver: "postgres", configured: true, reachable: true },
        storage: { driver: "filesystem" },
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
