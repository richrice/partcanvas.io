import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileScad } from "../scad/compiler";
import type { ParameterValue } from "../scad/parameters";
import type { HostedModel, HostedModelDraft } from "./types";

const MODEL_ID = /^[a-f0-9]{24}$/;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

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

function validateParameters(value: unknown): Record<string, ParameterValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, ParameterValue> = {};
  for (const [name, item] of Object.entries(value)) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    if (typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) output[name] = item;
    else if (Array.isArray(item) && item.length >= 1 && item.length <= 4 && item.every((component) => typeof component === "number" && Number.isFinite(component))) output[name] = item;
  }
  return output;
}

function validateDraft(input: HostedModelDraft): Required<HostedModelDraft> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw new Error("Model name is required");
  if (typeof input.source !== "string" || !input.source.trim()) throw new Error("Model source is required");
  if (input.source.length > 2_000_000) throw new Error("Model source exceeds the 2 MB limit");
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 1_000) : "";
  const rawFiles = input.files && typeof input.files === "object" && !Array.isArray(input.files) ? input.files : {};
  if (Object.keys(rawFiles).length > 128) throw new Error("A model can contain at most 128 files");
  let fileBytes = 0;
  const files: Record<string, string> = {};
  for (const [filename, contents] of Object.entries(rawFiles)) {
    if (typeof contents !== "string") throw new Error(`Model file '${filename}' must contain text`);
    fileBytes += contents.length;
    if (fileBytes > 2_000_000) throw new Error("Model files exceed the combined 2 MB limit");
    files[filename] = contents;
  }
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12)
    : [];
  return { name, description, source: input.source, files, parameters: validateParameters(input.parameters), tags };
}

export async function saveHostedModel(input: HostedModelDraft): Promise<{ model: HostedModel; created: boolean }> {
  const draft = validateDraft(input);
  const canonical = JSON.stringify(stableValue(draft));
  const id = createHash("sha256").update(canonical).digest("hex").slice(0, 24);
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
  if (!MODEL_ID.test(id)) return null;
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
