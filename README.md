# partcanvas.io

## [Open the public app →](https://partcanvas.io)

Create, customize, preview, and export parametric 3D models directly at **[partcanvas.io](https://partcanvas.io)**. The hosted [API documentation](https://partcanvas.io/docs/api) covers programmatic rendering and model publishing.

A native web implementation of the OpenSCAD modeling workflow. partcanvas.io parses and evaluates an OpenSCAD-compatible language in TypeScript; it does **not** ship or compile the OpenSCAD desktop binary.

The product is designed around two people:

- Authors script parametric, printable 3D models.
- Makers adjust a friendly parameter panel and download STL without editing code.

The same engine runs in the browser and behind an HTTP render API.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production deployment

The included image uses Next.js standalone output on Node.js 24 LTS and runs as an unprivileged user. Start it with a durable named volume:

```bash
docker compose up --build
curl http://localhost:3000/api/health
```

Compose mounts `partcanvas-models` at `/data/models`; rebuilding or replacing the container leaves published models intact. Do not use `docker compose down -v` unless deleting that model library is intentional. Set `PARTCANVAS_PORT` in `.env` to change the host port.

For a bare Node deployment, run `npm ci`, `npm run build`, and `npm start`, and set `PARTCANVAS_DATA_DIR` to a durable mounted directory. The readiness endpoint returns `503` if that directory cannot be written. A default local `.data/models` directory is convenient for development but the health payload marks it as `persistent: false` because no production mount was explicitly configured.

Hosted records are immutable JSON objects keyed by a content-derived ID. Concurrent identical publishes resolve to the same stored record. Run one application replica per local volume, or mount the same hard-link-capable read/write filesystem into every replica so all hosted URLs resolve consistently.

## API

Render a script to binary STL:

```bash
curl -X POST http://localhost:3000/api/render \
  -H 'content-type: application/json' \
  --data '{"source":"cube([10,20,4]);","parameters":{},"format":"stl"}' \
  --output model.stl
```

Request an OpenSCAD-style machine-readable render summary instead of file bytes:

```bash
curl -X POST http://localhost:3000/api/render \
  -H 'content-type: application/json' \
  --data '{"source":"cube([10,20,4]);","format":"stl","summary":["geometry","bounding-box","area","time"]}'
```

Inspect customizable parameters:

```bash
curl -X POST http://localhost:3000/api/parameters \
  -H 'content-type: application/json' \
  --data '{"source":"width = 20; // [5:1:60]\ncube(width);"}'
```

## Current language surface

The engine supports OpenSCAD scope-wide variables, expressions, vectors, vector/matrix multiplication, ranges, `if`, multi-variable `for`, `let`, filtered and flattened list comprehensions, recursive and nested user functions/modules, indexed `children()`, statement and expression forms of `assert()`/`echo()`, deterministic seeded `rands()`, common math functions, 2D/3D primitives, boolean operations, matrices, resize, offset, projection, hulls, linear/rotate extrusion, native 45-degree `roof(method="straight")` solids, and printable `surface()` geometry from text or PNG heightmaps. Compatibility is being expanded deliberately against OpenSCAD behavior.

`roof()` accepts both OpenSCAD method names. The straight-skeleton method is native and supports concave outlines, holes, and disconnected regions. The default `voronoi` method currently uses the straight-skeleton topology and emits a warning because rounded concave corners can differ; convex outlines are equivalent.

The render API accepts scalar or nested-vector `parameters`/`defines`, OpenSCAD Customizer JSON through `parameterFile`/`parameterSet` (CLI `-p`/`-P`), animation time through `$t`, preview mode through `$preview`, final scale/rotation/translation, print-bed placement, hard-warning behavior, facet resolution, and caller-selectable triangle limits. Preset values use the source parameter schema to decode OpenSCAD's string-encoded booleans, numbers, vectors, and choices; explicit API overrides win. Optional parameter and range checks report unknown names, type mismatches, invalid choices, and out-of-range values. Set `summary` to `true`, an OpenSCAD `--summary` category, or an array of categories to receive `--summary-file`-style JSON with output metadata, effective parameters, diagnostics, bounds, dimensions, triangle count, area/volume, and timing. Three-dimensional scripts return binary STL, Wavefront OBJ, or BambuStudio-ready 3MF; top-level 2D scripts return SVG or AutoCAD DXF for laser cutting, CNC, and other planar workflows.

For multicolor printing, create each filament region as a separate, non-overlapping top-level solid and wrap it with the standard OpenSCAD `color()` module. For example, `color("navy") cube([20,20,2]); color("gold") translate([5,5,2]) cube([10,10,1]);`. Export **BambuStudio 3MF (colors)** rather than STL: the 3MF contains one assembled object, a volume for each colored solid, per-volume extruder assignments, and matching filament slot colors. BambuStudio will retain those assignments when the project opens, although the physical AMS spool-to-slot mapping must still match the filaments actually loaded. Solids combined inside one `union()`, `difference()`, or other boolean operation are one printable volume and therefore one filament assignment.

The customizer recognizes OpenSCAD-style number, string, boolean, select, and one-to-four-component numeric vector controls. `/* [Hidden] */` variables stay out of the public form, and parameter descriptions may be supplied on the preceding comment line or inline. Add an OpenSCAD Customizer `.json` file to expose its named presets directly above the controls; choosing a preset resets unspecified controls to script defaults, and changing any control returns the selector to **Custom values**.

Multi-file projects are supported in the editor and API. Supply a `files` object keyed by project-relative path, then use normal `include <...>` and `use <...>` directives. Native `import()` supports STL, OBJ, SVG, and DXF assets, while `surface()` accepts numeric text grids and PNG heightmaps. Text assets may be sent directly and binary assets use standard base64 data URLs. The editor encodes uploaded assets automatically. Shared links compress the main source, library files, imported assets, and selected customizer values into one serverless URL.

Models can also be published as immutable, content-addressed records with `POST /api/models`. Hosted customizer pages use `/m/:id`. The default Node storage adapter writes to `.data/models`; set the task-specific `PARTCANVAS_DATA_DIR` environment variable to a mounted persistent-volume path in production.

OpenSCAD is GPL-licensed and is a separate project. partcanvas.io uses an independent TypeScript parser/evaluator, a pure-TypeScript straight-skeleton implementation, and the JavaScript JSCAD geometry toolkit. It does not use Emscripten, WebAssembly builds of OpenSCAD, or the OpenSCAD binary.
