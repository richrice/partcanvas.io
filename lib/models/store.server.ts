import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileScad } from "../scad/compiler";
import { CONTENT_ID, hashDraft, validateDraft } from "./draft.server";
import type { HostedModel, HostedModelDraft } from "./types";

function storageDirectory() {
  const configured = process.env.PARTCANVAS_DATA_DIR;
  return configured ? path.resolve(configured) : path.join(process.cwd(), ".data", "models");
}

export interface HostedModelStoreStatus {
  driver: "filesystem";
  persistent: boolean;
  writable: boolean;
  error?: string;
}

export async function inspectHostedModelStore(): Promise<HostedModelStoreStatus> {
  const directory = storageDirectory();
  const persistent = Boolean(process.env.PARTCANVAS_DATA_DIR?.trim());
  const probe = path.join(directory, `.health.${randomBytes(6).toString("hex")}.tmp`);
  let created = false;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(probe, "ok\n", { encoding: "utf8", flag: "wx" });
    created = true;
    await unlink(probe);
    created = false;
    return { driver: "filesystem", persistent, writable: true };
  } catch (error) {
    if (created) await unlink(probe).catch(() => undefined);
    const code = (error as NodeJS.ErrnoException).code;
    return { driver: "filesystem", persistent, writable: false, error: code || "storage-unavailable" };
  }
}

export async function saveHostedModel(input: HostedModelDraft): Promise<{ model: HostedModel; created: boolean }> {
  const draft = validateDraft(input);
  const id = hashDraft(draft);
  const directory = storageDirectory();
  const filename = path.join(directory, `${id}.json`);
  try {
    return { model: await readHostedModelRequired(id), created: false };
  } catch (error) {
    if (!(error instanceof Error) || !/not found/i.test(error.message)) throw error;
  }

  const compiled = compileScad(draft.source, { files: draft.files, parameters: draft.parameters });
  if (!compiled.geometry) throw new Error("The model must produce a 3D solid before it can be published");
  const model: HostedModel = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    ...draft,
    parameterSchema: compiled.parameters,
    metrics: compiled.metrics,
  };
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${id}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temporary, `${JSON.stringify(model, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    // Linking a fully-written temp file publishes the immutable record atomically
    // without allowing concurrent requests to replace an existing model.
    await link(temporary, filename);
    return { model, created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { model: await readHostedModelRequired(id), created: false };
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function readHostedModel(id: string): Promise<HostedModel | null> {
  if (!CONTENT_ID.test(id)) return null;
  try {
    const model = JSON.parse(await readFile(path.join(storageDirectory(), `${id}.json`), "utf8")) as HostedModel;
    return model?.version === 1 && model.id === id && typeof model.source === "string" ? model : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readHostedModelRequired(id: string) {
  const model = await readHostedModel(id);
  if (!model) throw new Error(`Hosted model '${id}' not found`);
  return model;
}
