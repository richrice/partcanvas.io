import { describe, expect, it } from "vitest";
import { decodeThumbnailDataUrl, THUMBNAIL_BYTE_LIMIT } from "./thumbnails.server";

// 1x1 transparent PNG.
const PNG_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("decodeThumbnailDataUrl", () => {
  it("decodes a valid PNG data URL", () => {
    const bytes = decodeThumbnailDataUrl(PNG_PIXEL);
    expect(bytes).not.toBeNull();
    expect([...bytes!.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects non-PNG payloads, wrong mime types, and oversize inputs", () => {
    expect(decodeThumbnailDataUrl(undefined)).toBeNull();
    expect(decodeThumbnailDataUrl("not a data url")).toBeNull();
    expect(decodeThumbnailDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBeNull();
    expect(decodeThumbnailDataUrl(`data:image/png;base64,${Buffer.from("GIF89a not a png").toString("base64")}`)).toBeNull();
    const oversize = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(THUMBNAIL_BYTE_LIMIT)]).toString("base64")}`;
    expect(decodeThumbnailDataUrl(oversize)).toBeNull();
  });
});
