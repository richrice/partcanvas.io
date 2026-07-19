import { geometries } from "@jscad/modeling";
import type { Geom2 } from "@jscad/modeling/src/geometries/types";
import { resolveFont } from "./fonts";

export interface TextGeometryOptions {
  text: string;
  size: number;
  font: string;
  halign: string;
  valign: string;
  spacing: number;
  direction: string;
  segments: number;
}

export interface TextGeometryResult {
  geometry: Geom2 | null;
  /** False when the requested font fell back to a bundled face. */
  fontMatched: boolean;
  usedFontName: string;
}

// OpenSCAD sizes glyphs as `size`-point type rendered at 100 dpi, i.e. a scale
// of size * (100/72) / unitsPerEm — calibrated against OpenSCAD 2026 output.
const POINT_SCALE = 100 / 72;

export function textGeometry(options: TextGeometryOptions): TextGeometryResult {
  const { size, spacing, segments } = options;
  const resolved = resolveFont(options.font);
  const font = resolved.font;
  const scale = size * POINT_SCALE / font.unitsPerEm;
  // Quadratic arcs are short; a fraction of the full-circle fragment count is enough.
  const curveSegments = Math.min(16, Math.max(3, Math.round(segments / 8)));

  let codePoints = [...options.text];
  if (options.direction === "rtl") codePoints = codePoints.reverse();

  const contours: [number, number][][] = [];
  let penX = 0;
  for (const character of codePoints) {
    const glyphId = font.glyphIndex(character.codePointAt(0) ?? 0);
    for (const contour of font.glyphContours(glyphId, curveSegments)) {
      contours.push(contour.map(([x, y]) => [penX + x * scale, y * scale]));
    }
    penX += font.advanceWidth(glyphId) * scale * spacing;
  }
  if (!contours.length) return { geometry: null, fontMatched: resolved.matched, usedFontName: resolved.usedName };

  // halign offsets by the advance width of the line (matching OpenSCAD);
  // valign offsets by the rendered outline's vertical extent.
  const offsetX = options.halign === "center" ? -penX / 2 : options.halign === "right" ? -penX : 0;
  let offsetY = 0;
  if (options.valign === "top" || options.valign === "center" || options.valign === "bottom") {
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const contour of contours) {
      for (const [, y] of contour) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    offsetY = options.valign === "top" ? -yMax : options.valign === "bottom" ? -yMin : -(yMin + yMax) / 2;
  }

  // TrueType orients outer contours clockwise and holes counter-clockwise;
  // reversing every contour yields the CCW-outer / CW-hole windings JSCAD expects.
  const sides: [[number, number], [number, number]][] = [];
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index++) {
      const from = contour[(index + 1) % contour.length];
      const to = contour[index];
      sides.push([
        [from[0] + offsetX, from[1] + offsetY],
        [to[0] + offsetX, to[1] + offsetY],
      ]);
    }
  }
  return { geometry: geometries.geom2.create(sides), fontMatched: resolved.matched, usedFontName: resolved.usedName };
}
