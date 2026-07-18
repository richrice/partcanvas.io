import { createHash } from "node:crypto";
import type { ParameterValue } from "../scad/parameters";
import type { HostedModelDraft } from "./types";

// 24-hex content-derived revision/model ID (sha256 prefix of the canonical draft).
export const CONTENT_ID = /^[a-f0-9]{24}$/;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
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

export function validateDraft(input: HostedModelDraft): Required<HostedModelDraft> {
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

// The content hash covers the validated draft only (not createdAt or compiled
// outputs), so identical publishes at different times converge on one record.
export function hashDraft(draft: Required<HostedModelDraft>): string {
  return createHash("sha256").update(JSON.stringify(stableValue(draft))).digest("hex").slice(0, 24);
}
