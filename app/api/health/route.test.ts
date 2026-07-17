import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GET } from "./route";

let testDirectory = "";
const previousStorage = process.env.PARTCANVAS_DATA_DIR;

beforeAll(async () => {
  testDirectory = await mkdtemp(path.join(os.tmpdir(), "partcanvas-health-"));
});

afterAll(async () => {
  if (previousStorage === undefined) delete process.env.PARTCANVAS_DATA_DIR;
  else process.env.PARTCANVAS_DATA_DIR = previousStorage;
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
});
