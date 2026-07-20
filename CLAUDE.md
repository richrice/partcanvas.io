# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                          # dev server at http://localhost:3000
npm run build                        # production build (Next.js standalone output)
npm run lint                         # eslint
npm run typecheck                    # tsc --noEmit
npm test                             # run all tests once (vitest, node environment; DB tests use in-memory PGlite)
npm run test:watch                   # vitest watch mode
npx vitest run lib/scad/engine.test.ts        # single test file
npx vitest run -t "roof"             # tests matching a name
npm run db:generate                  # regenerate SQL migrations in drizzle/ after editing lib/db/schema.ts
make deploy                          # deploy working tree to Railway (requires railway CLI)
docker compose up --build            # local production run (app + Postgres 17; Postgres volume holds the model library)
docker compose up -d postgres        # just Postgres, for `npm run dev` (DATABASE_URL in .env.example)
```

Requires Node >= 24. Tests are colocated with source (`*.test.ts` next to the file they cover). Path alias `@/*` maps to the repo root.

## What this is

A native TypeScript reimplementation of the OpenSCAD modeling workflow — parser, evaluator, and exporters — with no OpenSCAD binary, Emscripten, or WASM. The **same engine runs everywhere**: client-side for live preview — normally inside a Web Worker (`lib/compile-worker.ts`), with a synchronous main-thread fallback — and server-side behind the HTTP render API. Engine code must therefore stay isomorphic: nothing under `lib/scad/`, `lib/share.ts`, or `lib/project-assets.ts` may import Node built-ins or touch the DOM. Server-only code uses the `.server.ts` suffix (e.g. `lib/models/revisions.server.ts`).

Compatibility is deliberately measured against real OpenSCAD behavior (CLI flags, Customizer JSON, `--summary` output, string-encoded parameter values). When expanding the language surface, match OpenSCAD semantics and update the README's "Current language surface" section — the README doubles as the feature spec and public API documentation.

## Engine pipeline (`lib/scad/`)

Source text flows through:

1. `files.ts` — multi-file resolution: `include <...>` / `use <...>` are textually inlined before parsing (files supplied as a path→content map). `canonicalProjectPath` rejects absolute paths and traversal.
2. `lexer.ts` → `parser.ts` → `ast.ts` — OpenSCAD-compatible parse.
3. `evaluator.ts` (the largest file) — walks the AST producing JSCAD geometry (`@jscad/modeling` `Geom2`/`Geom3`). Home of all builtin modules/functions, `import()` deserializers (STL/OBJ/SVG/DXF), `surface()` (text grids + PNG heightmaps via fast-png), and `roof()` (delegates to `roof.ts`, a straight-skeleton implementation).
4. `compiler.ts` — the public entry points: `compileScad()` (parse + evaluate + metrics, returns geometry, per-color `parts`, warnings, parameter schema) and `serializeGeometry()` (STL/OBJ/SVG/DXF via @jscad serializers; 3MF via `bambu-3mf.ts` with per-color volumes and extruder assignments; STEP via `step.ts` faceted B-rep).

Alongside the pipeline:

- `parameters.ts` — extracts the OpenSCAD Customizer schema from annotated comments (`// [5:1:60]`, `/* [Section] */`, `[Hidden]`) and validates/coerces overrides. Both the ParameterPanel UI and the API build on this schema.
- `parameter-sets.ts` — OpenSCAD Customizer `.json` preset files; uses the parameter schema to decode OpenSCAD's string-encoded booleans/numbers/vectors.
- `editor-language.ts` — CodeMirror 6 StreamLanguage + autocompletion for the editor only; keep its keyword/builtin lists in sync when adding language features.
- `examples.ts` — built-in example scripts and `DEFAULT_SOURCE`.

## App structure

- `components/Workspace.tsx` — the main client component; owns all editor/parameter/compile state and compiles through `lib/compile-cache.ts` (memory + IndexedDB cache over a Web Worker running `compileScad`; falls back to synchronous main-thread compile where workers are unavailable). Composes `CodeEditor` (CodeMirror), `ModelViewport` (three.js), `ParameterPanel`, and `PrintSetupPanel`. FDM printer profiles, bed-fit/placement calculations, geometry checks, and material estimates live in the isomorphic `lib/fdm.ts`; device-local print preferences are stored under `partcanvas.print-settings`.
- `app/page.tsx` renders an empty Workspace; `app/m/[id]/page.tsx` reads a hosted model server-side and passes it as `initialModel`.
- `app/api/` — Node-runtime routes: `render` (script → STL/OBJ/3MF/STEP/SVG/DXF or `--summary`-style JSON), `parameters`, `models` (publish/fetch), `health`, `capabilities`. CORS is wide open via `next.config.ts` headers plus `lib/api/cors.ts` preflight; new API routes need `export const OPTIONS = corsPreflight`.
- Hosted-model storage: published models are immutable content-addressed **revisions** (24-hex sha256-derived ID) stored in Postgres. `lib/db/` holds the Drizzle schema (`schema.ts`), the pg/PGlite client seam (`client.server.ts`, with `setDatabaseForTests`), and the PGlite test harness (`test-db.server.ts`); migrations live in `drizzle/` and run at boot via `instrumentation.ts` when `DATABASE_URL` is set (without it the app runs engine-only). `lib/models/revisions.server.ts` is the revision store (`ON CONFLICT DO NOTHING` dedup); `lib/models/models.server.ts` is the social layer (models, versions, forks, explore); draft validation/hashing sits in `lib/models/draft.server.ts`.
- `lib/share.ts` — serverless share links: model source, files, and parameter values gzip-compressed (fflate) and base64url-encoded into the URL.

## Deployment

Railway, via `railway.json` + `Dockerfile` (node:24-alpine, Next standalone output, unprivileged user, `drizzle/` copied in for boot migrations). The Railway project runs a `Postgres` service; `web` gets `DATABASE_URL` as a service reference plus the Better Auth / OAuth env vars. `make deploy` runs `railway up` on the working tree — it does not deploy from git. `/api/health` is the readiness check: with `DATABASE_URL` set it returns 503 when Postgres is unreachable; an engine-only instance without a database reports ready.
