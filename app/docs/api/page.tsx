import { ArrowLeft, Box, Braces, Check, Code2 } from "lucide-react";
import Link from "next/link";

const renderExample = `curl -X POST https://partcanvas.io/api/render \\
  -H 'content-type: application/json' \\
  --data '{
    "source": "width = 20; cube([width, 12, 4]);",
    "defines": { "width": 36, "holes": [4, 8, 12] },
    "format": "3mf",
    "filename": "custom-part",
    "options": {
      "fn": 48,
      "origin": "bed",
      "maxTriangles": 1000000
    }
  }' \\
  --output custom-part.3mf`;

const inspectExample = `curl -X POST https://partcanvas.io/api/parameters \\
  -H 'content-type: application/json' \\
  --data '{
    "source": "width = 20; // [5:1:60]\\ncube(width);"
  }'`;

const summaryExample = `curl -X POST https://partcanvas.io/api/render \\
  -H 'content-type: application/json' \\
  --data '{
    "source": "width = 20; cube([width, 12, 4]);",
    "parameters": { "width": 36 },
    "format": "stl",
    "summary": ["geometry", "bounding-box", "area", "time"]
  }'`;

export default function ApiDocsPage() {
  return (
    <main className="docs-shell">
      <header className="docs-topbar">
        <Link className="brand" href="/"><span className="brand-mark"><Box size={18} /></span><span>partcanvas<span>.io</span></span></Link>
        <Link className="docs-back" href="/"><ArrowLeft size={15} /> Back to editor</Link>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <span>API REFERENCE</span>
          <a href="#render" className="active">Render model</a>
          <a href="#summary">Render summary</a>
          <a href="#parameters">Inspect parameters</a>
          <a href="#models">Hosted models</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#health">Health</a>
          <a href="#errors">Errors</a>
        </aside>
        <article className="docs-content">
          <div className="docs-hero">
            <span className="eyebrow"><Code2 size={13} /> HTTP API</span>
            <h1>Parametric models, on demand.</h1>
            <p>Use the same native TypeScript CAD engine as the editor to inspect scripts, override public parameters, and generate printable 3D or fabrication-ready 2D files.</p>
          </div>

          <section id="render" className="docs-section">
            <div className="endpoint-title"><span className="method">POST</span><code>/api/render</code></div>
            <p>Compile an OpenSCAD-compatible source string and return STL, OBJ, faceted B-rep STEP, BambuStudio-ready 3MF, SVG, or DXF geometry. SVG and DXF select top-level 2D geometry; the other formats require a 3D solid. STEP preserves the engine&apos;s planar boundary faces in millimeters; it does not reconstruct analytic features. A 3MF preserves separate top-level <code>color()</code> solids as assembled volumes with matching filament and extruder assignments.</p>
            <div className="docs-grid">
              <div>
                <h3>JSON body</h3>
                <table><tbody>
                  <tr><td><code>source</code></td><td>string</td><td>Required model source.</td></tr>
                  <tr><td><code>parameters</code></td><td>object</td><td>Top-level values, equivalent to OpenSCAD <code>-D</code> overrides.</td></tr>
                  <tr><td><code>defines</code></td><td>object</td><td>Alias for <code>parameters</code>; supports nested vectors.</td></tr>
                  <tr><td><code>parameterFile</code></td><td>string/object</td><td>OpenSCAD Customizer JSON file, equivalent to <code>-p</code>. Use a project-relative filename from <code>files</code>, or provide the parsed JSON object inline.</td></tr>
                  <tr><td><code>parameterSet</code></td><td>string</td><td>Named preset from <code>parameterFile</code>, equivalent to <code>-P</code>. Explicit <code>defines</code>/<code>parameters</code> override preset values.</td></tr>
                  <tr><td><code>files</code></td><td>object</td><td>Project-relative SCAD, STL/OBJ/SVG/DXF, or text/PNG heightmap assets. Send binary files as base64 data URLs.</td></tr>
                  <tr><td><code>format</code></td><td>string</td><td><code>stl</code> (default), BambuStudio-compatible <code>3mf</code>, <code>step</code>, <code>obj</code>, <code>svg</code>, or <code>dxf</code>.</td></tr>
                  <tr><td><code>filename</code></td><td>string</td><td>Download filename without extension.</td></tr>
                  <tr><td><code>summary</code></td><td>boolean/string[]</td><td>Return JSON statistics instead of file bytes. Use <code>true</code>/<code>all</code>, or OpenSCAD-compatible categories: <code>cache</code>, <code>time</code>, <code>camera</code>, <code>geometry</code>, <code>bounding-box</code>, and <code>area</code>.</td></tr>
                  <tr><td><code>options.fn</code></td><td>number</td><td>Global facet resolution, 3–256.</td></tr>
                  <tr><td><code>options.time</code></td><td>number</td><td>Animation position from 0–1, exposed to the script as <code>$t</code>.</td></tr>
                  <tr><td><code>options.preview</code></td><td>boolean</td><td>Value exposed to the script as <code>$preview</code>; defaults to <code>false</code> for final output.</td></tr>
                  <tr><td><code>options.checkParameters</code></td><td>boolean</td><td>Warn for unknown overrides, type mismatches, and values outside declared select options.</td></tr>
                  <tr><td><code>options.checkParameterRanges</code></td><td>boolean</td><td>Also validate numeric and vector components against Customizer ranges.</td></tr>
                  <tr><td><code>options.origin</code></td><td>string</td><td><code>source</code>, <code>center</code>, or place on the print <code>bed</code>.</td></tr>
                  <tr><td><code>options.scale</code></td><td>number/vector</td><td>Uniform scalar or XYZ final scale.</td></tr>
                  <tr><td><code>options.rotate</code></td><td>vector</td><td>Final XYZ rotation in degrees.</td></tr>
                  <tr><td><code>options.translate</code></td><td>vector</td><td>Final XYZ translation.</td></tr>
                  <tr><td><code>options.hardWarnings</code></td><td>boolean</td><td>Fail when the compiler emits any warning.</td></tr>
                  <tr><td><code>options.maxTriangles</code></td><td>number</td><td>Caller-selected complexity guard, capped at five million.</td></tr>
                </tbody></table>
              </div>
              <div className="code-card"><div><Braces size={13} /> cURL</div><pre>{renderExample}</pre></div>
            </div>
            <div className="response-row"><Check size={15} /><span><strong>200</strong> model file</span><span>Metadata is returned in dimension, triangle, volume/area, compile-time, selected-preset, and parameter-warning headers.</span></div>
          </section>

          <section id="summary" className="docs-section">
            <div className="endpoint-title"><span className="method">POST</span><code>/api/render</code><span className="endpoint-qualifier">JSON summary</span></div>
            <p>Set <code>summary</code> to <code>true</code> for every category, or select the same category names accepted by OpenSCAD <code>--summary</code>. The model is still compiled and serialized, but the response is JSON rather than file bytes—equivalent to using <code>--summary-file</code> for a web render.</p>
            <p>Every summary includes output format, filename, MIME type and exact byte size; effective parameter values and selected <code>-p</code>/<code>-P</code> set; warnings; and <code>echo()</code> messages. Category fields add bounds and dimensions, triangle/facet counts, 2D or 3D surface area, volume, and compile/serialization/total timing. <code>camera</code> is <code>null</code> for geometry exports, and <code>cache</code> reports the stateless request scope.</p>
            <div className="code-card wide"><div><Braces size={13} /> cURL</div><pre>{summaryExample}</pre></div>
          </section>

          <section id="parameters" className="docs-section">
            <div className="endpoint-title"><span className="method">POST</span><code>/api/parameters</code></div>
            <p>Validate source and return its customizer schema, groups, defaults, ranges, vector controls, and select options. Send optional <code>values</code> and <code>checkRanges</code> to receive structured diagnostics before rendering. Supplying <code>parameterFile</code> discovers all named OpenSCAD presets; add <code>parameterSet</code> to resolve one into typed values.</p>
            <div className="code-card wide"><div><Braces size={13} /> cURL</div><pre>{inspectExample}</pre></div>
          </section>

          <section id="capabilities" className="docs-section">
            <div className="endpoint-title"><span className="method get">GET</span><code>/api/capabilities</code></div>
            <p>Machine-readable discovery for supported primitives, modeling operations, language constructs, and output formats.</p>
            <p>The project file surface supports <code>include</code>, <code>use</code>, native <code>import()</code> of STL, OBJ, SVG, and DXF, and printable <code>surface()</code> geometry from text or PNG heightmaps without invoking the desktop OpenSCAD binary.</p>
            <p>Language discovery includes scope-wide assignment semantics, nested definitions, vector and matrix math, expression-form assertions and tracing, deterministic seeded random vectors, and OpenSCAD <code>-p</code>/<code>-P</code> Customizer preset files.</p>
            <p>Native <code>roof(method=&quot;straight&quot;)</code> creates closed 45-degree solids over convex, concave, holed, or disconnected 2D children. The <code>voronoi</code> method is accepted with a disclosed straight-skeleton fallback; convex output is equivalent, while rounded concave corners can differ.</p>
          </section>

          <section id="models" className="docs-section">
            <div className="endpoint-title"><span className="method">POST</span><code>/api/models</code></div>
            <p>Validate and publish an immutable model record. Send <code>name</code>, <code>source</code>, and optional <code>description</code>, <code>files</code>, <code>parameters</code>, and <code>tags</code>. The response includes a content-derived ID and hosted customizer URL at <code>/m/:id</code>.</p>
            <div className="endpoint-title secondary-endpoint"><span className="method get">GET</span><code>/api/models/:id</code></div>
            <p>Retrieve the source project, default customizer values, inferred parameter schema, and verified geometry metrics for a hosted model.</p>
          </section>

          <section id="health" className="docs-section">
            <div className="endpoint-title"><span className="method get">GET</span><code>/api/health</code></div>
            <p>Readiness probe for deployments and container orchestrators. A <code>200</code> response reports a writable hosted-model store; <code>503</code> means the configured storage directory cannot accept writes. The <code>storage.persistent</code> flag is true when <code>PARTCANVAS_DATA_DIR</code> explicitly selects a mounted path.</p>
          </section>

          <section id="errors" className="docs-section">
            <h2>Error responses</h2>
            <p>Validation and compile failures use JSON with an <code>error</code> string. Invalid input returns <code>400</code>, oversized source returns <code>413</code>, and parse or geometry failures return <code>422</code>.</p>
          </section>
        </article>
      </div>
    </main>
  );
}
