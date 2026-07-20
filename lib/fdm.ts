import { geometries, transforms } from "@jscad/modeling";
import type { Geom3 } from "@jscad/modeling/src/geometries/types";
import { isGeom3, type CadGeometry } from "./scad/evaluator";

export type BedShape = "rectangular" | "circular";
export type RightAngle = 0 | 90 | 180 | 270;

export interface PrinterProfile {
  id: string;
  name: string;
  shortName: string;
  width: number;
  depth: number;
  height: number;
  bedShape: BedShape;
  nozzleDiameter: number;
}

export interface CustomPrinterProfile extends Omit<PrinterProfile, "id"> {
  id: "custom";
}

export interface PrintSettings {
  profileId: string;
  customProfile: CustomPrinterProfile;
  safetyMargin: number;
  nozzleDiameter: number;
  materialId: string;
  filamentDiameter: number;
  showBed: boolean;
  showBuildVolume: boolean;
  exportPlacement: boolean;
}

export interface ModelPlacement {
  x: number;
  y: number;
  rotationZ: RightAngle;
}

export interface ModelBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BedFitAnalysis {
  fits: boolean;
  fitsX: boolean;
  fitsY: boolean;
  fitsZ: boolean;
  modelSize: [number, number, number];
  printableSize: [number, number, number];
  spare: [number, number, number];
  edgeClearance: number;
  overflow: [number, number, number];
  utilization: number;
}

export interface FdmGeometryAnalysis {
  contactArea: number;
  contactRatio: number;
  severeOverhangArea: number;
  severeOverhangRatio: number;
  minDimension: number;
  partCount: number;
}

export interface MaterialProfile {
  id: string;
  name: string;
  density: number;
}

export interface MaterialEstimate {
  volumeCm3: number;
  massGrams: number;
  filamentLengthMeters: number;
}

export const PRINTER_PROFILES: PrinterProfile[] = [
  { id: "generic-220", name: "Generic 220 × 220 × 250", shortName: "220 mm printer", width: 220, depth: 220, height: 250, bedShape: "rectangular", nozzleDiameter: 0.4 },
  { id: "bambu-a1-mini", name: "Bambu Lab A1 mini", shortName: "A1 mini", width: 180, depth: 180, height: 180, bedShape: "rectangular", nozzleDiameter: 0.4 },
  { id: "bambu-256", name: "Bambu Lab A1 / P1 / X1", shortName: "Bambu 256", width: 256, depth: 256, height: 256, bedShape: "rectangular", nozzleDiameter: 0.4 },
  { id: "prusa-mk4s", name: "Original Prusa MK4S", shortName: "Prusa MK4S", width: 250, depth: 210, height: 220, bedShape: "rectangular", nozzleDiameter: 0.4 },
  { id: "ender-3-v3-se", name: "Creality Ender-3 V3 SE", shortName: "Ender-3 V3 SE", width: 220, depth: 220, height: 250, bedShape: "rectangular", nozzleDiameter: 0.4 },
];

export const MATERIAL_PROFILES: MaterialProfile[] = [
  { id: "pla", name: "PLA", density: 1.24 },
  { id: "petg", name: "PETG", density: 1.27 },
  { id: "abs", name: "ABS / ASA", density: 1.05 },
  { id: "tpu", name: "TPU", density: 1.21 },
  { id: "nylon", name: "Nylon", density: 1.14 },
];

export const DEFAULT_CUSTOM_PRINTER: CustomPrinterProfile = {
  id: "custom",
  name: "Custom printer",
  shortName: "Custom printer",
  width: 220,
  depth: 220,
  height: 250,
  bedShape: "rectangular",
  nozzleDiameter: 0.4,
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  profileId: "generic-220",
  customProfile: DEFAULT_CUSTOM_PRINTER,
  safetyMargin: 2,
  nozzleDiameter: 0.4,
  materialId: "pla",
  filamentDiameter: 1.75,
  showBed: true,
  showBuildVolume: true,
  exportPlacement: true,
};

export const DEFAULT_MODEL_PLACEMENT: ModelPlacement = { x: 0, y: 0, rotationZ: 0 };

const finitePositive = (value: unknown, fallback: number, maximum = 10_000) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(numeric, maximum) : fallback;
};

export function normalizePrintSettings(value: unknown): PrintSettings {
  if (!value || typeof value !== "object") return DEFAULT_PRINT_SETTINGS;
  const candidate = value as Partial<PrintSettings>;
  const custom = candidate.customProfile as Partial<CustomPrinterProfile> | undefined;
  const profileId = candidate.profileId === "custom" || PRINTER_PROFILES.some((profile) => profile.id === candidate.profileId)
    ? candidate.profileId!
    : DEFAULT_PRINT_SETTINGS.profileId;
  return {
    profileId,
    customProfile: {
      ...DEFAULT_CUSTOM_PRINTER,
      name: typeof custom?.name === "string" && custom.name.trim() ? custom.name.trim().slice(0, 60) : DEFAULT_CUSTOM_PRINTER.name,
      shortName: typeof custom?.shortName === "string" && custom.shortName.trim() ? custom.shortName.trim().slice(0, 30) : DEFAULT_CUSTOM_PRINTER.shortName,
      width: finitePositive(custom?.width, DEFAULT_CUSTOM_PRINTER.width),
      depth: finitePositive(custom?.depth, DEFAULT_CUSTOM_PRINTER.depth),
      height: finitePositive(custom?.height, DEFAULT_CUSTOM_PRINTER.height),
      bedShape: custom?.bedShape === "circular" ? "circular" : "rectangular",
      nozzleDiameter: finitePositive(custom?.nozzleDiameter, DEFAULT_CUSTOM_PRINTER.nozzleDiameter, 5),
    },
    safetyMargin: candidate.safetyMargin === undefined
      ? DEFAULT_PRINT_SETTINGS.safetyMargin
      : Math.max(0, Math.min(Number(candidate.safetyMargin) || 0, 100)),
    nozzleDiameter: finitePositive(candidate.nozzleDiameter, DEFAULT_PRINT_SETTINGS.nozzleDiameter, 5),
    materialId: MATERIAL_PROFILES.some((material) => material.id === candidate.materialId) ? candidate.materialId! : DEFAULT_PRINT_SETTINGS.materialId,
    filamentDiameter: finitePositive(candidate.filamentDiameter, DEFAULT_PRINT_SETTINGS.filamentDiameter, 5),
    showBed: candidate.showBed !== false,
    showBuildVolume: candidate.showBuildVolume !== false,
    exportPlacement: candidate.exportPlacement !== false,
  };
}

export function selectedPrinter(settings: PrintSettings): PrinterProfile {
  return settings.profileId === "custom"
    ? { ...settings.customProfile, nozzleDiameter: settings.nozzleDiameter }
    : { ...(PRINTER_PROFILES.find((profile) => profile.id === settings.profileId) ?? PRINTER_PROFILES[0]), nozzleDiameter: settings.nozzleDiameter };
}

export function normalizeRightAngle(value: number): RightAngle {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  return normalized as RightAngle;
}

export function dimensionsFromBounds(bounds: ModelBounds): [number, number, number] {
  return [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
}

export function rotatedModelSize(bounds: ModelBounds, rotationZ: RightAngle): [number, number, number] {
  const dimensions = dimensionsFromBounds(bounds);
  return rotationZ === 90 || rotationZ === 270
    ? [dimensions[1], dimensions[0], dimensions[2]]
    : dimensions;
}

export function analyzeBedFit(bounds: ModelBounds, printer: PrinterProfile, safetyMargin: number, placement: ModelPlacement): BedFitAnalysis {
  const modelSize = rotatedModelSize(bounds, placement.rotationZ);
  const margin = Math.max(0, safetyMargin);
  const printableWidth = Math.max(0, printer.width - margin * 2);
  const printableDepth = Math.max(0, printer.depth - margin * 2);
  const printableHeight = Math.max(0, printer.height);
  const halfWidth = modelSize[0] / 2;
  const halfDepth = modelSize[1] / 2;
  let fitsX: boolean;
  let fitsY: boolean;
  let edgeClearance: number;
  let overflowX = 0;
  let overflowY = 0;

  if (printer.bedShape === "circular") {
    const radius = Math.max(0, Math.min(printer.width, printer.depth) / 2 - margin);
    const farthestCorner = Math.max(
      Math.hypot(placement.x - halfWidth, placement.y - halfDepth),
      Math.hypot(placement.x + halfWidth, placement.y - halfDepth),
      Math.hypot(placement.x - halfWidth, placement.y + halfDepth),
      Math.hypot(placement.x + halfWidth, placement.y + halfDepth),
    );
    fitsX = farthestCorner <= radius + 1e-9;
    fitsY = fitsX;
    edgeClearance = radius - farthestCorner;
    overflowX = Math.max(0, farthestCorner - radius);
    overflowY = overflowX;
  } else {
    const left = printableWidth / 2 + placement.x - halfWidth;
    const right = printableWidth / 2 - placement.x - halfWidth;
    const front = printableDepth / 2 + placement.y - halfDepth;
    const back = printableDepth / 2 - placement.y - halfDepth;
    fitsX = left >= -1e-9 && right >= -1e-9;
    fitsY = front >= -1e-9 && back >= -1e-9;
    edgeClearance = Math.min(left, right, front, back);
    overflowX = Math.max(0, -left, -right);
    overflowY = Math.max(0, -front, -back);
  }

  const fitsZ = modelSize[2] <= printableHeight + 1e-9;
  const spare: [number, number, number] = [
    printableWidth - modelSize[0],
    printableDepth - modelSize[1],
    printableHeight - modelSize[2],
  ];
  return {
    fits: fitsX && fitsY && fitsZ,
    fitsX,
    fitsY,
    fitsZ,
    modelSize,
    printableSize: [printableWidth, printableDepth, printableHeight],
    spare,
    edgeClearance,
    overflow: [overflowX, overflowY, Math.max(0, -spare[2])],
    utilization: printableWidth > 0 && printableDepth > 0
      ? Math.min(1, (modelSize[0] * modelSize[1]) / (printableWidth * printableDepth))
      : 1,
  };
}

export function bestBedRotation(bounds: ModelBounds, printer: PrinterProfile, safetyMargin: number): RightAngle {
  if (printer.bedShape === "circular") return 0;
  const score = (rotationZ: RightAngle) => {
    const analysis = analyzeBedFit(bounds, printer, safetyMargin, { x: 0, y: 0, rotationZ });
    const normalizedX = analysis.spare[0] / Math.max(1, analysis.printableSize[0]);
    const normalizedY = analysis.spare[1] / Math.max(1, analysis.printableSize[1]);
    return (analysis.fits ? 10 : 0) + Math.min(normalizedX, normalizedY);
  };
  return score(90) > score(0) ? 90 : 0;
}

export function placeGeometriesOnBed(geometriesToPlace: CadGeometry[], bounds: ModelBounds, placement: ModelPlacement): CadGeometry[] {
  const centerX = (bounds.min[0] + bounds.max[0]) / 2;
  const centerY = (bounds.min[1] + bounds.max[1]) / 2;
  const centered = geometriesToPlace.map((geometry) => transforms.translate([-centerX, -centerY, -bounds.min[2]], geometry) as CadGeometry);
  const rotated = placement.rotationZ
    ? centered.map((geometry) => transforms.rotateZ(placement.rotationZ * Math.PI / 180, geometry) as CadGeometry)
    : centered;
  return placement.x || placement.y
    ? rotated.map((geometry) => transforms.translate([placement.x, placement.y, 0], geometry) as CadGeometry)
    : rotated;
}

function triangleArea(a: number[], b: number[], c: number[]) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const magnitude = Math.hypot(cross[0], cross[1], cross[2]);
  return { area: magnitude / 2, normalZ: magnitude ? cross[2] / magnitude : 0 };
}

export function analyzeFdmGeometry(geometry: CadGeometry | CadGeometry[], bounds: ModelBounds, overhangAngle = 50): FdmGeometryAnalysis {
  const solids = (Array.isArray(geometry) ? geometry : [geometry]).filter(isGeom3) as Geom3[];
  const dimensions = dimensionsFromBounds(bounds);
  const epsilon = Math.max(1e-5, Math.max(...dimensions) * 1e-6);
  const severeNormalZ = -Math.sin(overhangAngle * Math.PI / 180);
  let contactArea = 0;
  let severeOverhangArea = 0;
  let totalArea = 0;

  for (const solid of solids) {
    for (const polygon of geometries.geom3.toPolygons(solid)) {
      if (polygon.vertices.length < 3) continue;
      const a = polygon.vertices[0];
      for (let index = 1; index < polygon.vertices.length - 1; index += 1) {
        const b = polygon.vertices[index];
        const c = polygon.vertices[index + 1];
        const measured = triangleArea(a, b, c);
        totalArea += measured.area;
        const onBottom = Math.max(a[2], b[2], c[2]) <= bounds.min[2] + epsilon;
        if (onBottom && Math.abs(measured.normalZ) > 0.98) contactArea += measured.area;
        else if (measured.normalZ < severeNormalZ) severeOverhangArea += measured.area;
      }
    }
  }

  const footprintArea = Math.max(epsilon, dimensions[0] * dimensions[1]);
  const positiveDimensions = dimensions.filter((dimension) => dimension > epsilon);
  return {
    contactArea,
    contactRatio: Math.min(1, contactArea / footprintArea),
    severeOverhangArea,
    severeOverhangRatio: totalArea ? severeOverhangArea / totalArea : 0,
    minDimension: positiveDimensions.length ? Math.min(...positiveDimensions) : 0,
    partCount: solids.length,
  };
}

export function estimateMaterial(volumeMm3: number, materialId: string, filamentDiameter: number): MaterialEstimate {
  const material = MATERIAL_PROFILES.find((candidate) => candidate.id === materialId) ?? MATERIAL_PROFILES[0];
  const volumeCm3 = Math.max(0, volumeMm3) / 1000;
  const filamentArea = Math.PI * (Math.max(0.1, filamentDiameter) / 2) ** 2;
  return {
    volumeCm3,
    massGrams: volumeCm3 * material.density,
    filamentLengthMeters: Math.max(0, volumeMm3) / filamentArea / 1000,
  };
}
