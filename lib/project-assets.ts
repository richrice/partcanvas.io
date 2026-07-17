const MIME_BY_EXTENSION: Record<string, string> = {
  stl: "model/stl",
  obj: "text/plain",
  svg: "image/svg+xml",
  dxf: "application/dxf",
  png: "image/png",
  dat: "text/plain",
  scad: "text/plain",
  json: "application/json",
};

export interface DecodedProjectAsset {
  bytes: Uint8Array;
  text: string;
  mimeType: string;
}

export function extensionOf(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeProjectAsset(filename: string, bytes: Uint8Array) {
  const mimeType = MIME_BY_EXTENSION[extensionOf(filename)] ?? "application/octet-stream";
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

export function decodeProjectAsset(filename: string, content: string): DecodedProjectAsset {
  const dataUrl = content.match(/^data:([^;,]*)(?:;charset=[^;,]*)?(;base64)?,([\s\S]*)$/i);
  if (dataUrl) {
    const bytes = dataUrl[2] ? base64ToBytes(dataUrl[3]) : new TextEncoder().encode(decodeURIComponent(dataUrl[3]));
    return { bytes, text: new TextDecoder().decode(bytes), mimeType: dataUrl[1] || MIME_BY_EXTENSION[extensionOf(filename)] || "application/octet-stream" };
  }
  const bytes = new TextEncoder().encode(content);
  return { bytes, text: content, mimeType: MIME_BY_EXTENSION[extensionOf(filename)] ?? "text/plain" };
}

export async function readProjectFile(file: File): Promise<string> {
  if (extensionOf(file.name) === "scad") return file.text();
  return encodeProjectAsset(file.name, new Uint8Array(await file.arrayBuffer()));
}

export function isEditableProjectFile(filename: string) {
  return extensionOf(filename) === "scad";
}
