# partcanvas.io

## [Open the public app →](https://partcanvas.io)

Create, customize, preview, and export parametric 3D models directly at **[partcanvas.io](https://partcanvas.io)**. The hosted [API documentation](https://partcanvas.io/docs/api) covers programmatic rendering and model hosting.

A native web implementation of the OpenSCAD modeling workflow. partcanvas.io parses and evaluates an OpenSCAD-compatible language in TypeScript; it does **not** ship or compile the OpenSCAD desktop binary.

The product is designed around two people:

- Authors script parametric, printable 3D models.
- Makers adjust a friendly parameter panel and download STL, STEP, and other fabrication formats without editing code.

The community library is the front door, ShaderToy-style: the [home page](https://partcanvas.io) is a browsable, searchable gallery of published models, and the editor lives one click away at [`/new`](https://partcanvas.io/new). Sign in with GitHub or Google to publish models to a public profile at `/u/username`, and like, comment on, fork, or download other people's designs. Every published version keeps a permanent revision permalink at `/m/:id`, and each model page carries its license, clickable tags, view/download counts, dates, and a discussion thread. Owners can edit a model's details or delete it from the model page, and shared links unfurl with the model's thumbnail on Discord, Slack, and X.

The same engine runs in the browser and behind an HTTP render API.

## Development

```bash
npm install
docker compose up -d postgres   # local Postgres 17 for database-backed features
cp .env.example .env            # provides DATABASE_URL to the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Schema migrations apply automatically at boot whenever `DATABASE_URL` is set; without it the app still runs, skipping database-backed features. `npm test` needs no external services — database tests run against an in-memory PGlite instance.

## Production deployment

The included image uses Next.js standalone output on Node.js 24 LTS and runs as an unprivileged user. Start the full stack (app + Postgres 17) with:

```bash
docker compose up --build
curl http://localhost:3000/api/health
```

Published models are immutable JSON revisions keyed by a content-derived ID and stored in Postgres (`DATABASE_URL`); concurrent identical publishes resolve to the same stored record. Schema migrations run automatically at server boot, and the readiness endpoint returns `503` while the database is unreachable. Compose keeps Postgres data on the `partcanvas-postgres` named volume; do not use `docker compose down -v` unless deleting the model library is intentional. Set `PARTCANVAS_PORT` in `.env` to change the host port.

Deployments without `DATABASE_URL` run engine-only: the editor and render/parameter APIs work fully, while hosted models, accounts, and the community features are unavailable.

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
  --data '{"source":"WIDTH = 20; // [5:1:60]\ncube(WIDTH);"}'
```

## Current language surface

The engine supports OpenSCAD scope-wide variables, expressions, vectors, vector/matrix multiplication, ranges, `if`, multi-variable `for`, `let`, filtered and flattened list comprehensions, recursive and nested user functions/modules, indexed `children()`, statement and expression forms of `assert()`/`echo()`, deterministic seeded `rands()`, common math functions, 2D/3D primitives, boolean operations, matrices, resize, offset, projection, hulls, linear/rotate extrusion, native 45-degree `roof(method="straight")` solids, and printable `surface()` geometry from text or PNG heightmaps. Compatibility is being expanded deliberately against OpenSCAD behavior.

`text()` renders real glyph outlines from the bundled Liberation Sans family (Regular and Bold — the same default face OpenSCAD ships, embedded under the SIL Open Font License), with `size`, `halign`, `valign`, `spacing`, `direction` (`ltr`/`rtl`), and `font = "Family:style=Style"` matching OpenSCAD's metrics; other families and styles fall back to the closest Liberation Sans face with a warning, and kerning pairs are not yet applied. Boolean operators follow OpenSCAD child-node semantics — a `for` loop or module call counts as a single operand, and empty children are dropped — and an explicit `union()` of differently `color()`-ed subtrees keeps one part per color, so viewport colors and 3MF extruder assignment survive. Multi-part 3D exports (STL/OBJ) write each part as its own watertight shell, like OpenSCAD's lazy union, instead of boolean-merging them.

`roof()` accepts both OpenSCAD method names. The straight-skeleton method is native and supports concave outlines, holes, and disconnected regions. The default `voronoi` method currently uses the straight-skeleton topology and emits a warning because rounded concave corners can differ; convex outlines are equivalent.

The render API accepts scalar or nested-vector `parameters`/`defines`, OpenSCAD Customizer JSON through `parameterFile`/`parameterSet` (CLI `-p`/`-P`), animation time through `$t`, preview mode through `$preview`, final scale/rotation/translation, print-bed placement, hard-warning behavior, facet resolution, and caller-selectable triangle limits. Preset values use the source parameter schema to decode OpenSCAD's string-encoded booleans, numbers, vectors, and choices; explicit API overrides win. Optional parameter and range checks report unknown names, type mismatches, invalid choices, and out-of-range values. Set `summary` to `true`, an OpenSCAD `--summary` category, or an array of categories to receive `--summary-file`-style JSON with output metadata, effective parameters, diagnostics, bounds, dimensions, triangle count, area/volume, and timing. Three-dimensional scripts return binary STL, Wavefront OBJ, faceted B-rep STEP, or BambuStudio-ready 3MF; top-level 2D scripts return SVG or AutoCAD DXF for laser cutting, CNC, and other planar workflows.

For multicolor printing, create each filament region as a separate, non-overlapping top-level solid and wrap it with the standard OpenSCAD `color()` module. For example, `color("navy") cube([20,20,2]); color("gold") translate([5,5,2]) cube([10,10,1]);`. Export **BambuStudio 3MF (colors)** rather than STL: the 3MF contains one assembled object, a volume for each colored solid, per-volume extruder assignments, and matching filament slot colors. BambuStudio will retain those assignments when the project opens, although the physical AMS spool-to-slot mapping must still match the filaments actually loaded. Solids combined inside one `union()`, `difference()`, or other boolean operation are one printable volume and therefore one filament assignment.

The customizer recognizes OpenSCAD-style number, string, boolean, select, and one-to-four-component numeric vector controls. `ALL_CAPS` top-level variables (letters, digits, and underscores with no lowercase) are always exposed as customizer parameters. Mixed-case and lowercase variables are exposed only when the script shows explicit Customizer intent: the assignment sits under a named `/* [Section] */` group, or its same-line comment carries a control annotation that parses as a numeric range (`[max]`, `[min:max]`, `[min:step:max]`) or an option list (comma-separated, or the in-the-wild colon-separated form like `[PLA:PETG:ABS]`). Everything else stays internal to the script, though `parameters`/`defines` API overrides can still target any variable like OpenSCAD `-D`. `/* [Hidden] */` variables stay out of the public form, and parameter descriptions may be supplied on the preceding comment line or inline. Numeric display units are inferred from the name (angles show `°`, count-like names show no unit, everything else shows `mm`); a standalone `(mm)`, `(deg)`, or `(none)` token in the same-line comment overrides the inference and is removed from the description. Add an OpenSCAD Customizer `.json` file to expose its named presets directly above the controls; choosing a preset resets unspecified controls to script defaults, and changing any control returns the selector to **Custom values**.

Multi-file projects are supported in the editor and API. Supply a `files` object keyed by project-relative path, then use normal `include <...>` and `use <...>` directives. Native `import()` supports STL, OBJ, SVG, and DXF assets, while `surface()` accepts numeric text grids and PNG heightmaps. Text assets may be sent directly and binary assets use standard base64 data URLs. The editor encodes uploaded assets automatically. Shared links compress the main source, library files, imported assets, and selected customizer values into one serverless URL.

Signed-in users publish models as immutable, content-addressed revisions; hosted customizer pages use `/m/:id` and stay readable via `GET /api/models/:id`. Anonymous `POST /api/models` publishing is retired and returns `401` — sign in to publish, or use share links for accountless sharing. Programmatic publishing with per-account bearer API tokens is planned.

OpenSCAD is GPL-licensed and is a separate project. partcanvas.io uses an independent TypeScript parser/evaluator, a pure-TypeScript straight-skeleton implementation, and the JavaScript JSCAD geometry toolkit. It does not use Emscripten, WebAssembly builds of OpenSCAD, or the OpenSCAD binary.
