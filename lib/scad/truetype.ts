// Minimal TrueType font reader for text() rendering. Parses just the tables the
// engine needs — cmap (formats 4 and 12), glyf/loca (simple and composite
// glyphs), head, hhea, hmtx, maxp — and tessellates quadratic outlines into
// closed polygon contours in font units. Isomorphic: typed arrays only.

export interface ParsedFont {
  unitsPerEm: number;
  /** hhea ascender in font units (positive, above the baseline). */
  ascent: number;
  /** hhea descender in font units (negative, below the baseline). */
  descent: number;
  glyphIndex(codePoint: number): number;
  advanceWidth(glyphId: number): number;
  /**
   * Closed contours for a glyph, tessellated with `curveSegments` chords per
   * quadratic. Coordinates are font units, y up, in the font's native winding
   * (TrueType: outer contours clockwise, holes counter-clockwise).
   */
  glyphContours(glyphId: number, curveSegments: number): [number, number][][];
}

interface GlyphPoint {
  x: number;
  y: number;
  onCurve: boolean;
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

export function decodeBase64(data: string): Uint8Array {
  const lookup = new Int8Array(128).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const clean = data.replace(/=+$/, "");
  const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let buffer = 0;
  let bits = 0;
  let position = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = lookup[clean.charCodeAt(i)];
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[position++] = (buffer >> bits) & 0xff;
    }
  }
  return output.subarray(0, position);
}

export function parseTrueTypeFont(bytes: Uint8Array): ParsedFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(bytes[record], bytes[record + 1], bytes[record + 2], bytes[record + 3]);
    tables.set(tag, { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) });
  }
  const table = (tag: string) => {
    const entry = tables.get(tag);
    if (!entry) throw new Error(`Font is missing required table '${tag}'`);
    return entry.offset;
  };

  const head = table("head");
  const unitsPerEm = view.getUint16(head + 18);
  const indexToLocFormat = view.getUint16(head + 50);

  const hhea = table("hhea");
  const ascent = view.getInt16(hhea + 4);
  const descent = view.getInt16(hhea + 6);
  const numberOfHMetrics = view.getUint16(hhea + 34);

  const maxp = table("maxp");
  const numGlyphs = view.getUint16(maxp + 4);

  const hmtx = table("hmtx");
  const advanceWidth = (glyphId: number): number => {
    if (glyphId < 0 || glyphId >= numGlyphs) return 0;
    const index = Math.min(glyphId, numberOfHMetrics - 1);
    return view.getUint16(hmtx + index * 4);
  };

  // cmap: prefer a UCS-4 subtable (format 12), fall back to BMP format 4.
  const cmap = table("cmap");
  let subtableOffset = 0;
  let subtableFormat = 0;
  const cmapCount = view.getUint16(cmap + 2);
  for (let i = 0; i < cmapCount; i++) {
    const record = cmap + 4 + i * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const offset = cmap + view.getUint32(record + 4);
    const format = view.getUint16(offset);
    const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
    if (!unicode) continue;
    if (format === 12) {
      subtableOffset = offset;
      subtableFormat = 12;
      break;
    }
    if (format === 4 && subtableFormat !== 4) {
      subtableOffset = offset;
      subtableFormat = 4;
    }
  }
  if (!subtableOffset) throw new Error("Font has no usable Unicode cmap subtable");

  const glyphIndex = (codePoint: number): number => {
    if (subtableFormat === 12) {
      const groups = view.getUint32(subtableOffset + 12);
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const group = subtableOffset + 16 + mid * 12;
        const start = view.getUint32(group);
        const end = view.getUint32(group + 4);
        if (codePoint < start) high = mid - 1;
        else if (codePoint > end) low = mid + 1;
        else return view.getUint32(group + 8) + (codePoint - start);
      }
      return 0;
    }
    if (codePoint > 0xffff) return 0;
    const segCountX2 = view.getUint16(subtableOffset + 6);
    const endCodes = subtableOffset + 14;
    const startCodes = endCodes + segCountX2 + 2;
    const idDeltas = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;
    for (let segment = 0; segment < segCountX2; segment += 2) {
      if (view.getUint16(endCodes + segment) < codePoint) continue;
      const start = view.getUint16(startCodes + segment);
      if (start > codePoint) return 0;
      const rangeOffset = view.getUint16(idRangeOffsets + segment);
      if (rangeOffset === 0) return (codePoint + view.getInt16(idDeltas + segment)) & 0xffff;
      const glyphAddress = idRangeOffsets + segment + rangeOffset + (codePoint - start) * 2;
      const glyph = view.getUint16(glyphAddress);
      return glyph === 0 ? 0 : (glyph + view.getInt16(idDeltas + segment)) & 0xffff;
    }
    return 0;
  };

  const loca = table("loca");
  const glyf = table("glyf");
  const glyphOffset = (glyphId: number): [number, number] => {
    if (indexToLocFormat === 0) {
      return [view.getUint16(loca + glyphId * 2) * 2, view.getUint16(loca + glyphId * 2 + 2) * 2];
    }
    return [view.getUint32(loca + glyphId * 4), view.getUint32(loca + glyphId * 4 + 4)];
  };

  const glyphPoints = (glyphId: number, depth: number): { points: GlyphPoint[]; ends: number[] } => {
    const empty = { points: [], ends: [] };
    if (glyphId < 0 || glyphId >= numGlyphs || depth > 6) return empty;
    const [start, end] = glyphOffset(glyphId);
    if (start >= end) return empty;
    let cursor = glyf + start;
    const contourCount = view.getInt16(cursor);
    cursor += 10;

    if (contourCount >= 0) {
      const ends: number[] = [];
      for (let i = 0; i < contourCount; i++) {
        ends.push(view.getUint16(cursor));
        cursor += 2;
      }
      const pointCount = contourCount === 0 ? 0 : ends[ends.length - 1] + 1;
      cursor += 2 + view.getUint16(cursor); // instructions
      const flags: number[] = [];
      while (flags.length < pointCount) {
        const flag = bytes[cursor++];
        flags.push(flag);
        if (flag & REPEAT) {
          let repeats = bytes[cursor++];
          while (repeats-- > 0 && flags.length < pointCount) flags.push(flag);
        }
      }
      const points: GlyphPoint[] = flags.map((flag) => ({ x: 0, y: 0, onCurve: (flag & ON_CURVE) !== 0 }));
      let x = 0;
      for (let i = 0; i < pointCount; i++) {
        const flag = flags[i];
        if (flag & X_SHORT) {
          const delta = bytes[cursor++];
          x += flag & X_SAME_OR_POSITIVE ? delta : -delta;
        } else if (!(flag & X_SAME_OR_POSITIVE)) {
          x += view.getInt16(cursor);
          cursor += 2;
        }
        points[i].x = x;
      }
      let y = 0;
      for (let i = 0; i < pointCount; i++) {
        const flag = flags[i];
        if (flag & Y_SHORT) {
          const delta = bytes[cursor++];
          y += flag & Y_SAME_OR_POSITIVE ? delta : -delta;
        } else if (!(flag & Y_SAME_OR_POSITIVE)) {
          y += view.getInt16(cursor);
          cursor += 2;
        }
        points[i].y = y;
      }
      return { points, ends };
    }

    // Composite glyph: transform each component's points into place.
    const points: GlyphPoint[] = [];
    const ends: number[] = [];
    let flags = MORE_COMPONENTS;
    while (flags & MORE_COMPONENTS) {
      flags = view.getUint16(cursor);
      const componentId = view.getUint16(cursor + 2);
      cursor += 4;
      let dx = 0;
      let dy = 0;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        if (flags & ARGS_ARE_XY_VALUES) {
          dx = view.getInt16(cursor);
          dy = view.getInt16(cursor + 2);
        }
        cursor += 4;
      } else {
        if (flags & ARGS_ARE_XY_VALUES) {
          dx = view.getInt8(cursor);
          dy = view.getInt8(cursor + 1);
        }
        cursor += 2;
      }
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      if (flags & WE_HAVE_A_SCALE) {
        a = d = view.getInt16(cursor) / 16384;
        cursor += 2;
      } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
        a = view.getInt16(cursor) / 16384;
        d = view.getInt16(cursor + 2) / 16384;
        cursor += 4;
      } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
        a = view.getInt16(cursor) / 16384;
        b = view.getInt16(cursor + 2) / 16384;
        c = view.getInt16(cursor + 4) / 16384;
        d = view.getInt16(cursor + 6) / 16384;
        cursor += 8;
      }
      const component = glyphPoints(componentId, depth + 1);
      const base = points.length;
      for (const point of component.points) {
        points.push({ x: a * point.x + c * point.y + dx, y: b * point.x + d * point.y + dy, onCurve: point.onCurve });
      }
      for (const contourEnd of component.ends) ends.push(base + contourEnd);
    }
    return { points, ends };
  };

  const glyphContours = (glyphId: number, curveSegments: number): [number, number][][] => {
    const { points, ends } = glyphPoints(glyphId, 0);
    const contours: [number, number][][] = [];
    let first = 0;
    for (const last of ends) {
      const contour = points.slice(first, last + 1);
      first = last + 1;
      if (contour.length < 2) continue;
      const polygon = tessellateContour(contour, Math.max(1, curveSegments));
      if (polygon.length >= 3) contours.push(polygon);
    }
    return contours;
  };

  return { unitsPerEm, ascent, descent, glyphIndex, advanceWidth, glyphContours };
}

// A TrueType contour alternates on-curve points and quadratic control points;
// consecutive off-curve points imply an on-curve midpoint between them.
function tessellateContour(contour: GlyphPoint[], curveSegments: number): [number, number][] {
  const count = contour.length;
  // Expand implied midpoints so every control point sits between two on-curve
  // points, and rotate the walk to begin on an on-curve point.
  const expanded: GlyphPoint[] = [];
  const first = contour.findIndex((entry) => entry.onCurve);
  if (first === -1) {
    for (let i = 0; i < count; i++) {
      const current = contour[i];
      const next = contour[(i + 1) % count];
      expanded.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2, onCurve: true });
      expanded.push(next);
    }
  } else {
    for (let i = 0; i < count; i++) {
      const current = contour[(first + i) % count];
      const next = contour[(first + i + 1) % count];
      expanded.push(current);
      if (!current.onCurve && !next.onCurve) {
        expanded.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2, onCurve: true });
      }
    }
  }

  const total = expanded.length;
  const output: [number, number][] = [[expanded[0].x, expanded[0].y]];
  let index = 1;
  while (index <= total) {
    const entry = expanded[index % total];
    if (entry.onCurve) {
      if (index < total) output.push([entry.x, entry.y]);
      index += 1;
      continue;
    }
    const end = expanded[(index + 1) % total];
    const from = output[output.length - 1];
    for (let step = 1; step <= curveSegments; step++) {
      const t = step / curveSegments;
      const mt = 1 - t;
      output.push([
        mt * mt * from[0] + 2 * mt * t * entry.x + t * t * end.x,
        mt * mt * from[1] + 2 * mt * t * entry.y + t * t * end.y,
      ]);
    }
    index += 2;
  }
  // Remove the duplicated closing point and any zero-length steps.
  const deduped: [number, number][] = [];
  for (const point of output) {
    const previous = deduped[deduped.length - 1];
    if (previous && Math.abs(previous[0] - point[0]) < 1e-9 && Math.abs(previous[1] - point[1]) < 1e-9) continue;
    deduped.push(point);
  }
  const last = deduped[deduped.length - 1];
  if (deduped.length > 1 && Math.abs(last[0] - deduped[0][0]) < 1e-9 && Math.abs(last[1] - deduped[0][1]) < 1e-9) {
    deduped.pop();
  }
  return deduped;
}
