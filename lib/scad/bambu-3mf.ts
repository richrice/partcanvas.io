import { geometries } from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";
import { strToU8, zipSync } from "fflate";
import { boundsOfSolid, dimensionsFromBounds, packFootprints, type ModelBounds } from "../fdm";

const DEFAULT_COLOR: [number, number, number, number] = [0.46, 0.84, 0.76, 1];
const MAX_FILAMENTS = 32;
const CLUSTER_EPSILON = 0.001;

// Printable area of one plate plus the world-space stride between plate
// origins. Plate 0 is centered on the origin; BambuStudio tiles further
// plates along +X, so packed pieces land near their plate even if the
// slicer's own stride differs slightly.
export interface PlateSpec {
  printable: [number, number, number];
  stride: number;
}

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function num(value: number) {
  return Number(value.toFixed(3)).toString();
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

function boundsOverlap(a: ModelBounds, b: ModelBounds) {
  return [0, 1, 2].every((axis) => a.min[axis] <= b.max[axis] + CLUSTER_EPSILON && b.min[axis] <= a.max[axis] + CLUSTER_EPSILON);
}

// Overlapping or touching solids form one printed piece (e.g. the color
// shells of a multi-color part); solids separated in space are independent
// pieces that a slicer should arrange and plate on their own.
function clusterParts(bounds: ModelBounds[]): number[][] {
  const clusterOfPart: number[] = bounds.map(() => -1);
  const clusters: number[][] = [];
  for (let index = 0; index < bounds.length; index += 1) {
    if (clusterOfPart[index] !== -1) continue;
    const members = [index];
    clusterOfPart[index] = clusters.length;
    for (let cursor = 0; cursor < members.length; cursor += 1) {
      for (let other = 0; other < bounds.length; other += 1) {
        if (clusterOfPart[other] !== -1 || !boundsOverlap(bounds[members[cursor]], bounds[other])) continue;
        clusterOfPart[other] = clusters.length;
        members.push(other);
      }
    }
    clusters.push(members);
  }
  return clusters;
}

function clusterBounds(bounds: ModelBounds[], members: number[]): ModelBounds {
  return {
    min: [0, 1, 2].map((axis) => Math.min(...members.map((part) => bounds[part].min[axis]))) as [number, number, number],
    max: [0, 1, 2].map((axis) => Math.max(...members.map((part) => bounds[part].max[axis]))) as [number, number, number],
  };
}

export function serializeBambu3mf(parts: Geom3[], name: string, plate?: PlateSpec): Uint8Array {
  if (!parts.length) throw new Error("3MF export requires at least one 3D part");
  const partColors = parts.map(colorHex);
  const filamentColors = [...new Set(partColors)];
  if (filamentColors.length > MAX_FILAMENTS) throw new Error(`BambuStudio 3MF export supports at most ${MAX_FILAMENTS} filament colors`);

  const partBounds = parts.map(boundsOfSolid);
  const clusters = clusterParts(partBounds);
  const colorGroupId = parts.length + clusters.length + 1;
  const safeName = xml(name);

  // Pack pieces onto plates only when they cannot stay where the model put
  // them: several pieces whose combined layout overflows the printable area.
  const combined = clusterBounds(partBounds, parts.map((_, index) => index));
  const combinedSize = dimensionsFromBounds(combined);
  const packing = plate && clusters.length > 1
    && (combinedSize[0] > plate.printable[0] + 1e-9 || combinedSize[1] > plate.printable[1] + 1e-9)
    ? packFootprints(clusters.map((members) => dimensionsFromBounds(clusterBounds(partBounds, members))), plate.printable)
    : null;

  const objects = parts.map((part, index) => {
    const filament = filamentColors.indexOf(partColors[index]);
    return `<object id="${index + 1}" type="model" name="${safeName} - color ${filament + 1}" pid="${colorGroupId}" pindex="${filament}">${meshXml(part)}</object>`;
  }).join("");
  const parents = clusters.map((members, cluster) => {
    const parentId = parts.length + cluster + 1;
    const parentName = clusters.length === 1 ? safeName : `${safeName} piece ${cluster + 1}`;
    const components = members.map((part) => `<component objectid="${part + 1}"/>`).join("");
    return `<object id="${parentId}" type="model" name="${parentName}"><components>${components}</components></object>`;
  }).join("");
  const items = clusters.map((members, cluster) => {
    const parentId = parts.length + cluster + 1;
    if (!packing) return `<item objectid="${parentId}" printable="1"/>`;
    const placement = packing.placements[cluster];
    const current = clusterBounds(partBounds, members);
    const offsetX = placement.plate * (plate as PlateSpec).stride + placement.centerX - (current.min[0] + current.max[0]) / 2;
    const offsetY = placement.centerY - (current.min[1] + current.max[1]) / 2;
    return `<item objectid="${parentId}" transform="1 0 0 0 1 0 0 0 1 ${num(offsetX)} ${num(offsetY)} 0" printable="1"/>`;
  }).join("");
  const colorGroup = filamentColors.map((color) => `<m:color color="${color}"/>`).join("");
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <metadata name="Application">BambuStudio-02.07.00.55</metadata>
  <metadata name="BambuStudio:3mfVersion">1</metadata>
  <metadata name="Title">${safeName}</metadata>
  <resources><m:colorgroup id="${colorGroupId}">${colorGroup}</m:colorgroup>${objects}${parents}</resources>
  <build>${items}</build>
</model>`;

  const objectConfigs = clusters.map((members, cluster) => {
    const parentId = parts.length + cluster + 1;
    const parentName = clusters.length === 1 ? safeName : `${safeName} piece ${cluster + 1}`;
    const partsConfig = members.map((part) => {
      const filament = filamentColors.indexOf(partColors[part]) + 1;
      return `<part id="${part + 1}" subtype="normal_part"><metadata key="name" value="Color ${filament}"/><metadata key="extruder" value="${filament}"/></part>`;
    }).join("");
    return `<object id="${parentId}"><metadata key="name" value="${parentName}"/>${partsConfig}</object>`;
  }).join("");
  const plateConfigs = packing
    ? Array.from({ length: packing.plateCount }, (_, plateIndex) => {
        const instances = clusters.map((_, cluster) => cluster)
          .filter((cluster) => packing.placements[cluster].plate === plateIndex)
          .map((cluster) => {
            const parentId = parts.length + cluster + 1;
            return `<model_instance><metadata key="object_id" value="${parentId}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${parentId}"/></model_instance>`;
          }).join("");
        return `<plate><metadata key="plater_id" value="${plateIndex + 1}"/><metadata key="plater_name" value=""/><metadata key="locked" value="false"/>${instances}</plate>`;
      }).join("")
    : "";
  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?><config>${objectConfigs}${plateConfigs}</config>`;
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
