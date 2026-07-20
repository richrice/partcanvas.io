import { describe, expect, it } from "vitest";
import { primitives } from "@jscad/modeling";
import {
  DEFAULT_CUSTOM_PRINTER,
  analyzeBedFit,
  analyzeFdmGeometry,
  bestBedRotation,
  estimateMaterial,
  normalizePrintSettings,
  placeGeometriesOnBed,
  type ModelBounds,
  type PrinterProfile,
} from "./fdm";
import { measurements } from "@jscad/modeling";

const bounds = (width: number, depth: number, height: number): ModelBounds => ({
  min: [0, 0, 0],
  max: [width, depth, height],
});

const rectangularPrinter: PrinterProfile = {
  id: "test",
  name: "Test printer",
  shortName: "Test",
  width: 220,
  depth: 180,
  height: 200,
  bedShape: "rectangular",
  nozzleDiameter: 0.4,
};

describe("FDM bed fitting", () => {
  it("accounts for margins, translation, and height", () => {
    const centered = analyzeBedFit(bounds(200, 160, 190), rectangularPrinter, 5, { x: 0, y: 0, rotationZ: 0 });
    expect(centered.fits).toBe(true);
    expect(centered.spare).toEqual([10, 10, 10]);
    expect(centered.edgeClearance).toBe(5);

    const shifted = analyzeBedFit(bounds(200, 160, 190), rectangularPrinter, 5, { x: 6, y: 0, rotationZ: 0 });
    expect(shifted.fits).toBe(false);
    expect(shifted.fitsX).toBe(false);
    expect(shifted.overflow[0]).toBe(1);
  });

  it("finds a 90 degree rotation for a rectangular bed", () => {
    const model = bounds(170, 210, 20);
    expect(analyzeBedFit(model, rectangularPrinter, 0, { x: 0, y: 0, rotationZ: 0 }).fits).toBe(false);
    expect(bestBedRotation(model, rectangularPrinter, 0)).toBe(90);
    expect(analyzeBedFit(model, rectangularPrinter, 0, { x: 0, y: 0, rotationZ: 90 }).fits).toBe(true);
  });

  it("checks all footprint corners on a circular bed", () => {
    const circular: PrinterProfile = { ...rectangularPrinter, width: 200, depth: 200, bedShape: "circular" };
    expect(analyzeBedFit(bounds(120, 120, 20), circular, 0, { x: 0, y: 0, rotationZ: 0 }).fits).toBe(true);
    expect(analyzeBedFit(bounds(150, 150, 20), circular, 0, { x: 0, y: 0, rotationZ: 0 }).fits).toBe(false);
  });

  it("places geometry at bed center and z zero without changing its size", () => {
    const cube = primitives.cuboid({ size: [20, 10, 5], center: [30, 40, 12.5] });
    const sourceBounds = measurements.measureBoundingBox(cube) as ModelBounds extends never ? never : [[number, number, number], [number, number, number]];
    const placed = placeGeometriesOnBed([cube], { min: sourceBounds[0], max: sourceBounds[1] }, { x: 8, y: -3, rotationZ: 90 });
    const placedBounds = measurements.measureBoundingBox(placed[0]) as [[number, number, number], [number, number, number]];
    expect(placedBounds[0][2]).toBeCloseTo(0);
    expect((placedBounds[0][0] + placedBounds[1][0]) / 2).toBeCloseTo(8);
    expect((placedBounds[0][1] + placedBounds[1][1]) / 2).toBeCloseTo(-3);
    expect(placedBounds[1][0] - placedBounds[0][0]).toBeCloseTo(10);
    expect(placedBounds[1][1] - placedBounds[0][1]).toBeCloseTo(20);
  });
});

describe("FDM print estimates", () => {
  it("measures a cuboid contact area and excludes its bed face from overhangs", () => {
    const cube = primitives.cuboid({ size: [20, 10, 5], center: [0, 0, 2.5] });
    const analysis = analyzeFdmGeometry(cube, bounds(20, 10, 5));
    expect(analysis.contactArea).toBeCloseTo(200);
    expect(analysis.contactRatio).toBeCloseTo(1);
    expect(analysis.severeOverhangArea).toBeCloseTo(0);
  });

  it("estimates mass and filament length from solid volume", () => {
    const estimate = estimateMaterial(1000, "pla", 1.75);
    expect(estimate.volumeCm3).toBe(1);
    expect(estimate.massGrams).toBeCloseTo(1.24);
    expect(estimate.filamentLengthMeters).toBeCloseTo(0.416, 2);
  });

  it("sanitizes persisted settings", () => {
    const normalized = normalizePrintSettings({
      profileId: "custom",
      customProfile: { ...DEFAULT_CUSTOM_PRINTER, width: -4, depth: 300, bedShape: "circular" },
      safetyMargin: 999,
      nozzleDiameter: 0,
    });
    expect(normalized.customProfile.width).toBe(DEFAULT_CUSTOM_PRINTER.width);
    expect(normalized.customProfile.depth).toBe(300);
    expect(normalized.customProfile.bedShape).toBe("circular");
    expect(normalized.safetyMargin).toBe(100);
    expect(normalized.nozzleDiameter).toBe(0.4);
  });
});
