export const THUMBNAIL_BYTE_LIMIT = 512 * 1024;

// Generation stamp for stored thumbnails. Bump (alongside the compile
// cache's CACHE_VERSION in lib/compile-cache.ts) whenever an engine change
// alters rendering; owners' browsers then re-capture on their next visit.
export const THUMBNAIL_VERSION = 1;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_URL_PREFIX = "data:image/png;base64,";

// Decodes a client-captured thumbnail data URL. Returns null for anything
// that is not a well-formed PNG within the size cap — thumbnails are
// best-effort and never fail a publish.
export function decodeThumbnailDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith(DATA_URL_PREFIX)) return null;
  const encoded = value.slice(DATA_URL_PREFIX.length);
  if (encoded.length > (THUMBNAIL_BYTE_LIMIT * 4) / 3 + 4) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > THUMBNAIL_BYTE_LIMIT) return null;
  if (PNG_MAGIC.some((byte, index) => bytes[index] !== byte)) return null;
  return bytes;
}
