import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate";
import type { ParameterValue } from "./scad/parameters";

export interface SharedModel {
  source: string;
  parameters: Record<string, ParameterValue>;
  files?: Record<string, string>;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeSharedModel(model: SharedModel): string {
  const payload = JSON.stringify({ v: 1, s: model.source, p: model.parameters, f: model.files ?? {} });
  return toBase64Url(gzipSync(strToU8(payload), { level: 9 }));
}

export function decodeSharedModel(encoded: string): SharedModel {
  if (encoded.length > 250_000) throw new Error("Shared model URL is too large");
  const payload = JSON.parse(strFromU8(gunzipSync(fromBase64Url(encoded)))) as unknown;
  if (!payload || typeof payload !== "object") throw new Error("Invalid shared model");
  const record = payload as { v?: unknown; s?: unknown; p?: unknown; f?: unknown };
  if (record.v !== 1 || typeof record.s !== "string" || record.s.length > 2_000_000) throw new Error("Unsupported shared model");
  const parameters: Record<string, ParameterValue> = {};
  if (record.p && typeof record.p === "object" && !Array.isArray(record.p)) {
    for (const [name, value] of Object.entries(record.p)) {
      if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) parameters[name] = value;
      else if (Array.isArray(value) && value.length >= 1 && value.length <= 4 && value.every((item) => typeof item === "number" && Number.isFinite(item))) parameters[name] = value;
    }
  }
  const files: Record<string, string> = {};
  if (record.f && typeof record.f === "object" && !Array.isArray(record.f)) {
    for (const [name, contents] of Object.entries(record.f)) {
      if (typeof contents === "string" && contents.length <= 500_000) files[name] = contents;
    }
  }
  return { source: record.s, parameters, files };
}
