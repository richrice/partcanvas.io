import { decodeBase64, parseTrueTypeFont, type ParsedFont } from "../truetype";
import { LIBERATION_SANS_REGULAR_BASE64 } from "./liberation-sans-regular";
import { LIBERATION_SANS_BOLD_BASE64 } from "./liberation-sans-bold";

export interface ResolvedFont {
  font: ParsedFont;
  /** False when the requested family or style is not bundled and a fallback was used. */
  matched: boolean;
  /** Human-readable name of the font actually used, for warnings. */
  usedName: string;
}

// OpenSCAD's default font is Liberation Sans; the same family is bundled here
// (unmodified Liberation 2.00.1, SIL OFL 1.1 — see LICENSE-Liberation.txt).
const parsed = new Map<string, ParsedFont>();

function load(key: "regular" | "bold"): ParsedFont {
  let font = parsed.get(key);
  if (!font) {
    font = parseTrueTypeFont(decodeBase64(key === "bold" ? LIBERATION_SANS_BOLD_BASE64 : LIBERATION_SANS_REGULAR_BASE64));
    parsed.set(key, font);
  }
  return font;
}

/**
 * Resolve an OpenSCAD `font=` request of the form "Family" or "Family:style=Style".
 * Unknown families and styles fall back to the closest bundled Liberation Sans face.
 */
export function resolveFont(request: string): ResolvedFont {
  const [rawFamily, ...options] = request.split(":");
  const family = rawFamily.trim().toLowerCase();
  let style = "";
  for (const option of options) {
    const styleMatch = option.match(/^\s*style\s*=\s*(.+?)\s*$/i);
    if (styleMatch) style = styleMatch[1].toLowerCase();
  }
  const familyMatched = family === "" || family === "liberation sans" || family === "liberationsans";
  const bold = /\bbold\b/.test(style);
  const styleMatched = style === "" || style === "regular" || style === "book" || style === "normal" || style === "bold";
  return {
    font: load(bold ? "bold" : "regular"),
    matched: familyMatched && styleMatched,
    usedName: bold ? "Liberation Sans:style=Bold" : "Liberation Sans",
  };
}
