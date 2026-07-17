import { geometries } from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";
import { strToU8, zipSync } from "fflate";

const DEFAULT_COLOR: [number, number, number, number] = [0.46, 0.84, 0.76, 1];
const MAX_FILAMENTS = 32;

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function colorHex(geometry: Geom3) {
  const color = geometry.color ?? DEFAULT_COLOR;
  return `#${[0, 1, 2].map((index) => Math.round(Math.min(1, Math.max(0, color[index] ?? 0)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}FF`;
}

function meshXml(geometry: Geom3) {
  const vertices: string[] = [];
  const triangles: string[] = [];
  let offset = 0;
  for (const polygon of geometries.geom3.toPolygons(geometry)) {
    if (polygon.vertices.length < 3) continue;
    for (const [x, y, z] of polygon.vertices) vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);
    for (let index = 1; index < polygon.vertices.length - 1; index += 1) {
      triangles.push(`<triangle v1="${offset}" v2="${offset + index}" v3="${offset + index + 1}"/>`);
    }
    offset += polygon.vertices.length;
  }
  return `<mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh>`;
}

export function serializeBambu3mf(parts: Geom3[], name: string): Uint8Array {
  if (!parts.length) throw new Error("3MF export requires at least one 3D part");
  const partColors = parts.map(colorHex);
  const filamentColors = [...new Set(partColors)];
  if (filamentColors.length > MAX_FILAMENTS) throw new Error(`BambuStudio 3MF export supports at most ${MAX_FILAMENTS} filament colors`);

  const parentId = parts.length + 1;
  const colorGroupId = parentId + 1;
  const safeName = xml(name);
  const objects = parts.map((part, index) => {
    const filament = filamentColors.indexOf(partColors[index]);
    return `<object id="${index + 1}" type="model" name="${safeName} - color ${filament + 1}" pid="${colorGroupId}" pindex="${filament}">${meshXml(part)}</object>`;
  }).join("");
  const components = parts.map((_, index) => `<component objectid="${index + 1}"/>`).join("");
  const colorGroup = filamentColors.map((color) => `<m:color color="${color}"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Application">BambuStudio-02.07.00.55</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <metadata name="Title">${safeName}</metadata>
  <resources><m:colorgroup id="${colorGroupId}">${colorGroup}</m:colorgroup>${objects}<object id="${parentId}" type="model" name="${safeName}"><components>${components}</components></object></resources>
  <build><item objectid="${parentId}" printable="1"/></build>
</model>`;

  const partsConfig = parts.map((_, index) => {
    const filament = filamentColors.indexOf(partColors[index]) + 1;
    return `<part id="${index + 1}" subtype="normal_part"><metadata key="name" value="Color ${filament}"/><metadata key="extruder" value="${filament}"/></part>`;
  }).join("");
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?><config><object id="${parentId}"><metadata key="name" value="${safeName}"/>${partsConfig}</object></config>`;
  const projectSettings = JSON.stringify({
    filament_colour: filamentColors,
    filament_diameter: filamentColors.map(() => "1.75"),
    filament_settings_id: filamentColors.map(() => "Default Filament"),
    printer_settings_id: "Default Printer",
  });
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

  return zipSync({
    "3D": { "3dmodel.model": strToU8(model) },
    Metadata: {
      "model_settings.config": strToU8(modelSettings),
      "project_settings.config": strToU8(projectSettings),
    },
    _rels: { ".rels": strToU8(relationships) },
    "[Content_Types].xml": strToU8(contentTypes),
  });
}
