import { describe, expect, it } from "vitest";
import { encode as encodePng } from "fast-png";
import { unzipSync } from "fflate";
import { encodeProjectAsset } from "../project-assets";
import { compileScad, geometryToBinaryStl, serializeGeometry } from "./compiler";
import { EXAMPLES } from "./examples";
import { extractParameters } from "./parameters";
import { parse } from "./parser";

describe("OpenSCAD-compatible parser", () => {
  it("parses assignments, modules, loops, transforms, and booleans", () => {
    const program = parse(`
      amount = 3;
      module peg(r = 2) { cylinder(h = 8, r = r); }
      difference() {
        cube([20, 20, 5]);
        for (x = [4:6:16]) translate([x, 10, 0]) peg(1.5);
      }
    `);
    expect(program.body).toHaveLength(3);
  });

  it("reports source locations for invalid syntax", () => {
    expect(() => parse("cube([1, 2,);")).toThrow(/1:12/);
  });

  it("parses functions, let expressions, and list comprehensions", () => {
    const program = parse(`
      function inset(v, amount = 2) = let(inner = v - amount * 2) max(1, inner);
      values = [for (i = [0:3]) if (i != 1) each [i, i + 10]];
      cube(inset(20));
    `);
    expect(program.body.map((statement) => statement.type)).toEqual(["function", "assignment", "call"]);
  });
});

describe("Customizer metadata", () => {
  it("extracts ranges, labels, sections, booleans, and select controls", () => {
    const parameters = extractParameters(`/* [Body] */
WIDTH = 40; // Outside width [10:2:80]
ENABLED = true; // Add the feature
STYLE = "round"; // [round:Rounded,square:Square]
module hidden() { PRIVATE = 3; }
`);
    expect(parameters).toHaveLength(3);
    expect(parameters[0]).toMatchObject({ name: "WIDTH", label: "Width", section: "Body", min: 10, step: 2, max: 80 });
    expect(parameters[1]).toMatchObject({ name: "ENABLED", type: "boolean" });
    expect(parameters[2].options).toHaveLength(2);
  });

  it("only exposes ALL_CAPS top-level variables", () => {
    const parameters = extractParameters(`WIDTH = 40; // [10:1:80]
width = 20; // [10:1:80]
Mixed_Case = 5;
helper_offset = WIDTH / 2;
$fn = 32;
`);
    expect(parameters.map((parameter) => parameter.name)).toEqual(["WIDTH"]);
  });

  it("extracts vector controls and excludes the Hidden section", () => {
    const parameters = extractParameters(`/* [Dimensions] */
// Overall XYZ size
DIMENSIONS = [30, 20, 4]; // [1:1:100]
QUALITY = 2; // [1:Draft,2:Normal,3:Fine]
/* [Hidden] */
INTERNAL_EPSILON = 0.01;
`);
    expect(parameters).toHaveLength(2);
    expect(parameters[0]).toMatchObject({
      name: "DIMENSIONS",
      description: "Overall XYZ size",
      type: "vector",
      defaultValue: [30, 20, 4],
      min: 1,
      step: 1,
      max: 100,
    });
    expect(parameters[1].options?.map((option) => option.value)).toEqual([1, 2, 3]);
  });

  it("infers unit steps for integer customizer ranges", () => {
    const [count, ratio] = extractParameters("COUNT = 7; // [3:14]\nRATIO = 0.5; // [0:1]");
    expect(count).toMatchObject({ min: 3, max: 14, step: 1 });
    expect(ratio.step).toBeCloseTo(0.01, 8);
  });

  it("leaves count-like parameters unitless and lengths in millimeters", () => {
    const parameters = extractParameters(`COLUMNS = 4; // [1:1:10]
ROWS = 3; // [1:1:10]
NUM_STEPS = 5;
TABS_PER_SIDE = 2;
SEGMENT_INDEX = 0;
WIDTH = 40;
ANGLE = 30;
`);
    const units = Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.unit]));
    expect(units).toEqual({
      COLUMNS: "",
      ROWS: "",
      NUM_STEPS: "",
      TABS_PER_SIDE: "",
      SEGMENT_INDEX: "",
      WIDTH: "mm",
      ANGLE: "°",
    });
  });

  it("recognizes exposed string and RGB color parameters", () => {
    const parameters = extractParameters(`
BODY = "navy";
ACCENT_COLOUR = [0.9, 0.2, 0.1];
DIMENSIONS = [10, 20, 3];
color(BODY) cube(DIMENSIONS);
color(c = ACCENT_COLOUR) translate([12, 0, 0]) cube(2);
`);
    expect(parameters.find((parameter) => parameter.name === "BODY")?.type).toBe("color");
    expect(parameters.find((parameter) => parameter.name === "ACCENT_COLOUR")?.type).toBe("color");
    expect(parameters.find((parameter) => parameter.name === "DIMENSIONS")?.type).toBe("vector");
  });
});

describe("CAD compiler", () => {
  it("builds a solid with accurate bounds and supports parameter overrides", () => {
    const source = `width = 10; // [2:1:30]\ncube([width, 12, 4]);`;
    const base = compileScad(source);
    const customized = compileScad(source, { parameters: { width: 22 } });
    expect(base.geometry).not.toBeNull();
    expect(base.metrics.dimensions).toEqual([10, 12, 4]);
    expect(customized.metrics.dimensions).toEqual([22, 12, 4]);
    expect(customized.metrics.volume).toBeCloseTo(22 * 12 * 4, 4);
  });

  it("normalizes clockwise OpenSCAD polygons before extrusion and boolean operations", () => {
    const result = compileScad(`
      union() {
        cube([10, 10, 10]);
        translate([10, 0, 0])
          linear_extrude(height = 10)
            polygon([[0, 5], [5, 5], [0, 0]]);
      }
    `);
    expect(result.metrics.dimensions?.[0]).toBeCloseTo(15, 8);
    expect(result.metrics.dimensions?.slice(1)).toEqual([10, 10]);
    expect(result.metrics.volume).toBeCloseTo(1125, 4);
    expect(result.warnings).toEqual([]);
  });

  it("evaluates modules, children, loops, hull, and difference", () => {
    const result = compileScad(`
      $fn = 16;
      module moved(v) { translate(v) children(); }
      difference() {
        hull() {
          for (x = [-8, 8]) moved([x, 0, 0]) cylinder(h = 6, r = 4);
        }
        cylinder(h = 8, r = 2);
      }
    `);
    expect(result.geometry).not.toBeNull();
    expect(result.metrics.triangles).toBeGreaterThan(40);
    expect(result.warnings).toEqual([]);
  });

  it("serializes printable binary STL", () => {
    const result = compileScad("sphere(r = 5, $fn = 16);");
    expect(result.geometry).not.toBeNull();
    const stl = geometryToBinaryStl(result.geometry!);
    expect(stl.byteLength).toBe(84 + result.metrics.triangles * 50);
  });

  it("evaluates recursive user functions, let bindings, comprehensions, each, and vector dot products", () => {
    const result = compileScad(`
      function factorial(n) = n <= 1 ? 1 : n * factorial(n - 1);
      function dimensions(w) = let(h = w / 2) [w, h, factorial(3)];
      values = [for (i = [1:3]) if (i != 2) each [i, i + 10]];
      dot = [1, 2, 3] * [4, 5, 6];
      echo(values, dot);
      cube(dimensions(20));
    `);
    expect(result.metrics.dimensions).toEqual([20, 10, 6]);
    expect(result.messages).toEqual(["[1,11,3,13] 32"]);
    expect(result.warnings).toEqual([]);
  });

  it("uses OpenSCAD scope-wide assignment semantics", () => {
    const result = compileScad(`
      width = 4;
      echo(width);
      cube([width, depth, 2]);
      width = 12;
      depth = 7;
    `);
    expect(result.metrics.dimensions).toEqual([12, 7, 2]);
    expect(result.messages).toEqual(["12"]);
  });

  it("supports nested module and function definitions", () => {
    const result = compileScad(`
      module outer(base) {
        function doubled(value) = value * 2;
        module inner(size) { cube([size, base, 3]); }
        inner(doubled(5));
      }
      outer(6);
    `);
    expect(result.metrics.dimensions).toEqual([10, 6, 3]);
    expect(result.warnings).toEqual([]);
  });

  it("supports assert and echo in expression context", () => {
    const result = compileScad(`
      function checked(value) = assert(value > 0, "must be positive") echo("checked", value = value) value * 2;
      cube([checked(4), 3, 2]);
    `);
    expect(result.metrics.dimensions).toEqual([8, 3, 2]);
    expect(result.messages).toEqual(["checked value = 4"]);
    expect(() => compileScad(`function checked(v) = assert(v > 0, "bad value") v; cube(checked(-1));`)).toThrow(/bad value/);
  });

  it("generates deterministic seeded random vectors and multiplies matrices", () => {
    const random = compileScad(`
      first = rands(2, 8, 4, 42);
      second = rands(2, 8, 4, 42);
      echo(first == second);
      transform = [[1,0,0,5],[0,1,0,6],[0,0,1,7],[0,0,0,1]];
      point = transform * [2,3,4,1];
      cube([point[0], point[1], point[2]]);
    `);
    expect(random.messages).toEqual(["true"]);
    expect(random.metrics.dimensions).toEqual([7, 9, 11]);

    const matrix = compileScad(`
      a = [[1,0,0,2],[0,1,0,3],[0,0,1,4],[0,0,0,1]];
      b = [[2,0,0,0],[0,2,0,0],[0,0,2,0],[0,0,0,1]];
      multmatrix(a * b) cube(1);
    `);
    expect(matrix.metrics.bounds?.min).toEqual([2, 3, 4]);
    expect(matrix.metrics.dimensions).toEqual([2, 2, 2]);
  });

  it("supports dependent multi-variable loops", () => {
    const result = compileScad(`
      for (x = [0, 10], y = [0, x * 2])
        translate([x, y, 0]) cube(2);
    `);
    expect(result.metrics.bounds?.min[0]).toBeCloseTo(0, 8);
    expect(result.metrics.bounds?.min[1]).toBeCloseTo(0, 8);
    expect(result.metrics.bounds?.min[2]).toBeCloseTo(0, 8);
    expect(result.metrics.bounds?.max).toEqual([12, 22, 2]);
  });

  it("supports axis-angle rotation, multmatrix, resize, and offset", () => {
    const rotated = compileScad(`rotate(a = 90, v = [0,0,1]) translate([10,0,0]) cube([2,4,6]);`);
    expect(rotated.metrics.dimensions?.[0]).toBeCloseTo(4, 8);
    expect(rotated.metrics.dimensions?.[1]).toBeCloseTo(2, 8);

    const matrix = compileScad(`multmatrix([[1,0,0,5],[0,1,0,6],[0,0,1,7],[0,0,0,1]]) cube(2);`);
    expect(matrix.metrics.bounds?.min).toEqual([5, 6, 7]);
    expect(matrix.metrics.bounds?.max).toEqual([7, 8, 9]);

    const resized = compileScad(`resize([20,0,10]) cube([10,5,2]);`);
    expect(resized.metrics.dimensions).toEqual([20, 5, 10]);

    const expanded = compileScad(`linear_extrude(height = 2) offset(r = 2) square([10,10]);`);
    expect(expanded.metrics.dimensions?.[0]).toBeCloseTo(14, 6);
    expect(expanded.metrics.dimensions?.[1]).toBeCloseTo(14, 6);
    expect(expanded.metrics.dimensions?.[2]).toBeCloseTo(2, 6);
  });

  it("builds printable 45-degree straight-skeleton roofs", () => {
    const result = compileScad(`roof(method = "straight") square(10, center = true);`);
    expect(result.geometry).not.toBeNull();
    expect(result.dimension).toBe(3);
    expect(result.metrics.dimensions?.[0]).toBeCloseTo(10, 6);
    expect(result.metrics.dimensions?.[1]).toBeCloseTo(10, 6);
    expect(result.metrics.dimensions?.[2]).toBeCloseTo(5, 6);
    expect(result.metrics.volume).toBeCloseTo(500 / 3, 4);
    expect(result.warnings).toEqual([]);
    expect(geometryToBinaryStl(result.geometry!).byteLength).toBeGreaterThan(84);
  });

  it("supports concave, holed, and disconnected roof outlines", () => {
    const concave = compileScad(`
      roof(method = "straight") polygon([[0,0],[10,0],[10,10],[6,10],[6,4],[4,4],[4,10],[0,10]]);
    `);
    expect(concave.geometry).not.toBeNull();
    expect(concave.metrics.dimensions?.[2]).toBeCloseTo(2, 6);
    expect(concave.metrics.volume).toBeGreaterThan(0);

    const holed = compileScad(`
      roof(method = "straight") difference() {
        square(20, center = true);
        circle(r = 4, $fn = 16);
      }
    `);
    expect(holed.geometry).not.toBeNull();
    expect(holed.metrics.dimensions?.[0]).toBeCloseTo(20, 3);
    expect(holed.metrics.volume).toBeGreaterThan(0);
    expect(geometryToBinaryStl(holed.geometry!).byteLength).toBeGreaterThan(84);

    const disconnected = compileScad(`
      roof(method = "straight") {
        square(4);
        translate([10, 0]) square(2);
      }
    `);
    expect(disconnected.geometry).not.toBeNull();
    expect(disconnected.metrics.dimensions?.[0]).toBeCloseTo(12, 6);
    expect(disconnected.metrics.dimensions?.[1]).toBeCloseTo(4, 3);
    expect(disconnected.metrics.dimensions?.[2]).toBeCloseTo(2, 3);
  });

  it("accepts OpenSCAD's default voronoi roof syntax with an explicit compatibility warning", () => {
    const result = compileScad(`roof() square(10);`);
    expect(result.geometry).not.toBeNull();
    expect(result.metrics.dimensions?.[2]).toBeCloseTo(5, 6);
    expect(result.warnings.some((warning) => warning.includes("straight-skeleton topology"))).toBe(true);
  });

  it("rotates scalar angles around the Z axis", () => {
    const result = compileScad("rotate(90) translate([10, 0, 0]) cube([2, 4, 6]);");
    expect(result.metrics.bounds?.min[0]).toBeCloseTo(-4, 8);
    expect(result.metrics.bounds?.min[1]).toBeCloseTo(10, 8);
    expect(result.metrics.bounds?.min[2]).toBeCloseTo(0, 8);
    expect(result.metrics.dimensions?.[0]).toBeCloseTo(4, 8);
    expect(result.metrics.dimensions?.[1]).toBeCloseTo(2, 8);
    expect(result.metrics.dimensions?.[2]).toBeCloseTo(6, 8);
  });

  it("resolves include/use project files while suppressing top-level geometry from use", () => {
    const result = compileScad(`
      include <config/dimensions.scad>
      use <lib/parts.scad>
      printable_part(WIDTH);
    `, {
      files: {
        "config/dimensions.scad": "WIDTH = 24;",
        "lib/parts.scad": `
          function half(value) = value / 2;
          module printable_part(size) { cube([size, half(size), 4]); }
          cube(500);
        `,
      },
    });
    expect(result.metrics.dimensions).toEqual([24, 12, 4]);
    expect(result.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "WIDTH", defaultValue: 24 })]));
  });

  it("reports missing and circular project files", () => {
    expect(() => compileScad("include <missing.scad>\ncube(1);")).toThrow(/was not provided/);
    expect(() => compileScad("include <a.scad>", { files: { "a.scad": "include <b.scad>", "b.scad": "include <a.scad>" } })).toThrow(/Circular include/);
  });

  it("imports binary STL and text OBJ project assets", () => {
    const sourceGeometry = compileScad("cube([10, 20, 3]);").geometry!;
    const stl = geometryToBinaryStl(sourceGeometry);
    const obj = serializeGeometry(sourceGeometry, "obj").data;
    const fromStl = compileScad('import("parts/block.stl");', {
      files: { "parts/block.stl": encodeProjectAsset("block.stl", stl) },
    });
    const fromObj = compileScad('import(file = "parts/block.obj");', {
      files: { "parts/block.obj": encodeProjectAsset("block.obj", obj) },
    });
    [fromStl, fromObj].forEach((result) => {
      expect(result.metrics.dimensions?.[0]).toBeCloseTo(10, 3);
      expect(result.metrics.dimensions?.[1]).toBeCloseTo(20, 3);
      expect(result.metrics.dimensions?.[2]).toBeCloseTo(3, 3);
    });
  });

  it("imports SVG and closed DXF paths for 2D extrusion", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10"><rect width="20" height="10" /></svg>`;
    const dxf = `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n4\n70\n1\n10\n0\n20\n0\n10\n30\n20\n0\n10\n30\n20\n10\n10\n0\n20\n10\n0\nENDSEC\n0\nEOF\n`;
    const fromSvg = compileScad('linear_extrude(height = 2) import("shape.svg");', { files: { "shape.svg": svg } });
    const fromDxf = compileScad('linear_extrude(height = 4) import("shape.dxf");', { files: { "shape.dxf": dxf } });
    expect(fromSvg.metrics.dimensions?.[0]).toBeCloseTo(20, 4);
    expect(fromSvg.metrics.dimensions?.[1]).toBeCloseTo(10, 4);
    expect(fromSvg.metrics.dimensions?.[2]).toBeCloseTo(2, 6);
    expect(fromDxf.metrics.dimensions).toEqual([30, 10, 4]);
  });

  it("reports missing and unsupported import assets", () => {
    expect(() => compileScad('import("missing.stl");')).toThrow(/Imported asset 'missing\.stl' was not provided/);
    expect(() => compileScad('import("part.3mf");', { files: { "part.3mf": "data:application/octet-stream;base64,AA==" } })).toThrow(/Unsupported import format/);
  });

  it("creates printable surfaces from text and PNG heightmaps", () => {
    const textSurface = compileScad('surface(file = "terrain.dat", center = true);', {
      files: { "terrain.dat": "1 2 3\n2 4 2\n3 2 5\n" },
    });
    const png = encodePng({
      width: 3,
      height: 2,
      channels: 1,
      depth: 8,
      data: Uint8Array.from([0, 64, 128, 128, 192, 255]),
    });
    const pngSurface = compileScad('scale([2, 2, 0.1]) surface("relief.png", center = true);', {
      files: { "relief.png": encodeProjectAsset("relief.png", png) },
    });
    expect(textSurface.geometry).not.toBeNull();
    expect(textSurface.metrics.bounds?.min.slice(0, 2)).toEqual([-1, -1]);
    expect(textSurface.metrics.dimensions).toEqual([2, 2, 5]);
    expect(pngSurface.metrics.dimensions?.[0]).toBeCloseTo(4, 6);
    expect(pngSurface.metrics.dimensions?.[1]).toBeCloseTo(2, 6);
    expect(pngSurface.metrics.dimensions?.[2]).toBeCloseTo(10, 5);
    expect(pngSurface.metrics.volume).toBeGreaterThan(0);
  });

  it("provides PI, API-controlled $t, and render-safe debug modifiers", () => {
    const animated = compileScad("cube([10 + 10 * $t, round(PI), 2]);", { time: 0.5 });
    const modifiers = compileScad("%cube(100); #cube([4, 5, 6]); *sphere(50);");
    expect(animated.metrics.dimensions).toEqual([15, 3, 2]);
    expect(modifiers.metrics.dimensions).toEqual([4, 5, 6]);
  });

  it("diagnoses unsafe parameter overrides when checks are enabled", () => {
    const result = compileScad(`
      WIDTH = 20; // [10:1:40]
      DIMENSIONS = [20, 10, 4]; // [1:1:50]
      STYLE = "round"; // [round,square]
      cube(DIMENSIONS);
    `, {
      parameters: { WIDTH: 100, DIMENSIONS: [20, 10], STYLE: "triangle", extra: true },
      checkParameters: true,
      checkParameterRanges: true,
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("WIDTH' must be between 10 and 40"),
      expect.stringContaining("DIMENSIONS' expects vector"),
      expect.stringContaining("STYLE' must be one of"),
      expect.stringContaining("Unknown parameter override 'extra'"),
    ]));
  });

  it("applies API-style final transforms and print-bed placement", () => {
    const result = compileScad(`translate([10,20,30]) cube([2,4,6]);`, {
      transform: { scale: 2, rotate: [0, 0, 90], origin: "bed" },
    });
    expect(result.metrics.dimensions?.[0]).toBeCloseTo(8, 8);
    expect(result.metrics.dimensions?.[1]).toBeCloseTo(4, 8);
    expect(result.metrics.dimensions?.[2]).toBeCloseTo(12, 8);
    expect(result.metrics.bounds?.min[0]).toBeCloseTo(-4, 8);
    expect(result.metrics.bounds?.min[1]).toBeCloseTo(-2, 8);
    expect(result.metrics.bounds?.min[2]).toBeCloseTo(0, 8);
  });

  it("serializes OBJ, STEP, and packaged 3MF", () => {
    const result = compileScad("cube(5);");
    const obj = serializeGeometry(result.geometry!, "obj");
    const step = serializeGeometry(result.geometry!, "step", "Test cube");
    const threeMf = serializeGeometry(result.geometry!, "3mf");
    expect(new TextDecoder().decode(obj.data)).toContain("# Wavefront OBJ file generated by JSCAD");
    expect(new TextDecoder().decode(obj.data)).toContain("\nv ");
    const stepText = new TextDecoder().decode(step.data);
    expect(step.mimeType).toBe("model/step");
    expect(stepText).toMatch(/^ISO-10303-21;/);
    expect(stepText).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN_CC2'))");
    expect(stepText).toContain("FACETED_BREP('Test cube'");
    expect(stepText.match(/CARTESIAN_POINT/g)).toHaveLength(8);
    expect(stepText.match(/FACE_SURFACE\('/g)).toHaveLength(12);
    expect(stepText.match(/PLANE\('/g)).toHaveLength(12);
    expect(stepText).toContain("END-ISO-10303-21;");
    expect([...threeMf.data.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(threeMf.data.byteLength).toBeGreaterThan(1000);
  });

  it("preserves colored top-level solids as BambuStudio filament volumes", () => {
    const result = compileScad(`
      color("red") cube([20, 20, 2]);
      color("blue") translate([5, 5, 2]) cube([10, 10, 1]);
    `);
    expect(result.parts).toHaveLength(2);
    expect(result.metrics.dimensions).toEqual([20, 20, 3]);

    const archive = unzipSync(serializeGeometry(result.parts, "3mf", "Two color tag").data);
    const model = new TextDecoder().decode(archive["3D/3dmodel.model"]);
    const modelSettings = new TextDecoder().decode(archive["Metadata/model_settings.config"]);
    const projectSettings = JSON.parse(new TextDecoder().decode(archive["Metadata/project_settings.config"]));
    expect(model).toContain("BambuStudio:3mfVersion");
    expect(model).toContain("BambuStudio-02.07.00.55");
    expect(model).toContain('<m:color color="#FF0000FF"/>');
    expect(model).toContain('<m:color color="#0000FFFF"/>');
    expect(model).toContain('<object id="3" type="model" name="Two color tag"><components><component objectid="1"/><component objectid="2"/></components></object>');
    expect(modelSettings).toContain('<part id="1" subtype="normal_part"><metadata key="name" value="Color 1"/><metadata key="extruder" value="1"/></part>');
    expect(modelSettings).toContain('<part id="2" subtype="normal_part"><metadata key="name" value="Color 2"/><metadata key="extruder" value="2"/></part>');
    expect(projectSettings.filament_colour).toEqual(["#FF0000FF", "#0000FFFF"]);
    expect(projectSettings.filament_settings_id).toEqual(["Default Filament", "Default Filament"]);
    expect(projectSettings.printer_settings_id).toBe("Default Printer");
  });

  it("compiles and serializes first-class 2D geometry", () => {
    const source = `difference() { square([30, 20]); translate([15, 10]) circle(r = 4, $fn = 32); }`;
    const result = compileScad(source, { outputDimension: "2d" });
    expect(result.dimension).toBe(2);
    expect(result.geometry).not.toBeNull();
    expect(result.metrics.dimensions?.[0]).toBeCloseTo(30, 3);
    expect(result.metrics.dimensions?.[1]).toBeCloseTo(20, 3);
    expect(result.metrics.dimensions?.[2]).toBe(0);
    expect(result.metrics.area).toBeGreaterThan(548);
    expect(result.metrics.area).toBeLessThan(551);
    expect(result.metrics.volume).toBeNull();
    expect(result.warnings).toEqual([]);

    const svg = new TextDecoder().decode(serializeGeometry(result.geometry!, "svg").data);
    const dxf = new TextDecoder().decode(serializeGeometry(result.geometry!, "dxf").data);
    expect(svg).toContain("<svg");
    expect(svg).toMatch(/width="30(?:\.\d+)?mm"/);
    expect(svg).toContain("<path");
    expect(dxf).toContain("LWPOLYLINE");
    expect(dxf).toMatch(/\nEOF\n/);
  });

  it("auto-selects 2D geometry while explicit 3D output remains print-safe", () => {
    const automatic = compileScad("square([12, 8]);", { outputDimension: "auto" });
    const printable = compileScad("square([12, 8]);");
    expect(automatic.dimension).toBe(2);
    expect(automatic.metrics.dimensions).toEqual([12, 8, 0]);
    expect(printable.dimension).toBeNull();
    expect(printable.geometry).toBeNull();
    expect(printable.warnings).toEqual(["1 top-level 2D object ignored for 3D output."]);
  });

  it("creates aligned printable text without a native font dependency", () => {
    const result = compileScad(`
      linear_extrude(height = 2)
        text("SCAD", size = 10, halign = "center", valign = "center", spacing = 1.1);
    `);
    expect(result.geometry).not.toBeNull();
    expect(result.metrics.dimensions?.[0]).toBeGreaterThan(20);
    expect(result.metrics.dimensions?.[1]).toBeGreaterThan(8);
    expect(result.metrics.dimensions?.[2]).toBeCloseTo(2, 6);
    expect(result.metrics.bounds?.min[0]).toBeCloseTo(-(result.metrics.dimensions?.[0] ?? 0) / 2, 5);
    expect(result.warnings).toEqual([]);
  });

  it.each(EXAMPLES)("compiles the $name example", (example) => {
    const result = compileScad(example.source);
    expect(result.geometry).not.toBeNull();
    expect(result.metrics.triangles).toBeGreaterThan(0);
  });
});
