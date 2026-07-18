import { corsPreflight } from "@/lib/api/cors";
import { PARTCANVAS_API_VERSION, PARTCANVAS_ENGINE } from "@/lib/api/meta";
import { hasDatabase } from "@/lib/db/client.server";

export const runtime = "nodejs";
export const OPTIONS = corsPreflight;

export async function GET() {
  return Response.json({
    engine: PARTCANVAS_ENGINE,
    apiVersion: PARTCANVAS_API_VERSION,
    openScadBinary: false,
    formats: ["stl", "obj", "3mf", "step", "svg", "dxf"],
    step: { representation: "faceted-brep", units: "millimeter", schema: "AUTOMOTIVE_DESIGN_CC2" },
    threeMf: { dialect: "BambuStudio", colors: "top-level color() solids", assignment: "per-volume-extruder" },
    primitives: ["cube", "sphere", "cylinder", "polyhedron", "square", "circle", "polygon", "text", "torus", "surface"],
    operations: ["union", "difference", "intersection", "intersection_for", "hull", "minkowski", "translate", "rotate", "scale", "resize", "mirror", "multmatrix", "color", "offset", "projection", "linear_extrude", "rotate_extrude", "roof"],
    roofMethods: { straight: "native", voronoi: "straight-skeleton-fallback" },
    language: ["variables", "scope-wide-assignments", "vectors", "matrix-multiplication", "ranges", "expressions", "if", "for", "let", "list-comprehensions", "each", "functions", "modules", "nested-definitions", "children", "assert", "echo", "expression-assert-echo", "seeded-rands"],
    renderOptions: ["parameterFile", "parameterSet", "summary", "fn", "time", "preview", "scale", "rotate", "translate", "origin", "checkParameters", "checkParameterRanges", "hardWarnings", "maxTriangles"],
    renderSummary: {
      response: "POST /api/render with summary=true or an array of categories",
      categories: ["all", "cache", "time", "camera", "geometry", "bounding-box", "area"],
      includes: ["output-metadata", "effective-parameters", "selected-parameter-set", "warnings", "messages"],
    },
    parameterSetFiles: { cliAliases: ["p", "P"], fileFormatVersion: "1", discovery: "POST /api/parameters" },
    parameterInputs: ["number", "string", "boolean", "vector", "null", "nested-array"],
    parameterValidation: ["unknown-parameter", "type-mismatch", "invalid-option", "out-of-range", "hard-warnings"],
    projectFiles: ["include", "use", "import", "customizer-parameter-json", "relative-paths", "cycle-detection", "binary-data-urls"],
    importFormats: ["stl", "obj", "svg", "dxf"],
    heightmapFormats: ["text-grid", "png"],
    hostedModels: { create: "POST /api/models", read: "GET /api/models/:id", page: "/m/:id" },
    service: { readiness: "GET /api/health", persistence: hasDatabase() ? "postgres" : "none" },
  });
}
