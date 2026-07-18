"use client";

import {
  Box,
  Braces,
  Check,
  ChevronDown,
  CirclePlay,
  CloudUpload,
  Code2,
  Download,
  FilePlus2,
  GitFork,
  Github,
  Heart,
  LoaderCircle,
  Maximize2,
  Menu,
  MoreHorizontal,
  Rotate3D,
  Share2,
  TerminalSquare,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthMenu } from "./AuthMenu";
import { CodeEditor, type CursorLocation } from "./CodeEditor";
import { ModelViewport } from "./ModelViewport";
import { ParameterPanel } from "./ParameterPanel";
import { compileScad, serializeGeometry, type CompileResult, type ExportFormat } from "@/lib/scad/compiler";
import { DEFAULT_SOURCE, EXAMPLES } from "@/lib/scad/examples";
import { defaultParameterValues, extractParameters, type ParameterValue } from "@/lib/scad/parameters";
import { extensionOf, isEditableProjectFile, readProjectFile } from "@/lib/project-assets";
import { resolveSourceFiles } from "@/lib/scad/files";
import { inspectOpenScadParameterSets, loadOpenScadParameterFile } from "@/lib/scad/parameter-sets";
import { authClient } from "@/lib/auth/client";
import { LICENSES, VISIBILITIES, type License, type Visibility } from "@/lib/models/types";
import { decodeSharedModel, encodeSharedModel } from "@/lib/share";

const format = (value: number) => value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);

export interface InitialWorkspaceModel {
  name: string;
  source: string;
  files?: Record<string, string>;
  parameters?: Record<string, ParameterValue>;
  hostedId?: string;
}

// Social chrome shown on /u/:username/:slug model pages (P3.2). Like/fork
// interactivity arrives with P3.4/P4.1.
export interface SocialChromeModel {
  modelId: string;
  title: string;
  description: string;
  license: License;
  authorUsername: string;
  authorName: string;
  likeCount: number;
  downloadCount: number;
  tags: string[];
}

export function Workspace({ initialModel, social }: { initialModel?: InitialWorkspaceModel; social?: SocialChromeModel }) {
  const [source, setSource] = useState(initialModel?.source ?? DEFAULT_SOURCE);
  const [projectFiles, setProjectFiles] = useState<Record<string, string>>(initialModel?.files ?? {});
  const [modelName, setModelName] = useState(initialModel?.name ?? "Phone stand");
  const [activeFile, setActiveFile] = useState("main.scad");
  const definitions = useMemo(() => {
    try {
      return extractParameters(resolveSourceFiles(source, projectFiles).source);
    } catch {
      return extractParameters(source);
    }
  }, [source, projectFiles]);
  const [parameters, setParameters] = useState<Record<string, ParameterValue>>(() => ({ ...defaultParameterValues(definitions), ...(initialModel?.parameters ?? {}) }));
  const [selectedPreset, setSelectedPreset] = useState("");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [fitViewRequest, setFitViewRequest] = useState(0);
  const [showExamples, setShowExamples] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("stl");
  const [mobilePanel, setMobilePanel] = useState<"code" | "preview" | "parameters">("preview");
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishDescription, setPublishDescription] = useState("");
  const [publishLicense, setPublishLicense] = useState<License>("CC-BY-4.0");
  const [publishVisibility, setPublishVisibility] = useState<Visibility>("public");
  const [publishTags, setPublishTags] = useState("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const { data: authSession } = authClient.useSession();
  const router = useRouter();
  const [cursorLocation, setCursorLocation] = useState<CursorLocation>({ line: 1, column: 1 });
  const uploadRef = useRef<HTMLInputElement>(null);
  const thumbnailCaptureRef = useRef<(() => string | null) | null>(null);
  const parameterPresets = useMemo(() => Object.keys(projectFiles)
    .filter((filename) => extensionOf(filename) === "json")
    .sort()
    .flatMap((filename) => {
      try {
        const file = loadOpenScadParameterFile(filename, projectFiles);
        return inspectOpenScadParameterSets(file, definitions).map((preset) => ({
          ...preset,
          key: JSON.stringify([filename, preset.name]),
          filename,
          warningCount: preset.diagnostics.length,
        }));
      } catch {
        return [];
      }
    }), [definitions, projectFiles]);
  const visibleSelectedPreset = parameterPresets.some((preset) => preset.key === selectedPreset) ? selectedPreset : "";

  useEffect(() => {
    if (initialModel) return;
    let shared: ReturnType<typeof decodeSharedModel> | null = null;
    const encoded = new URL(window.location.href).searchParams.get("model");
    if (encoded) {
      try { shared = decodeSharedModel(encoded); } catch { /* Keep the default model for malformed links. */ }
    }
    const saved = shared ? null : window.localStorage.getItem("partcanvas.source");
    const savedFiles = shared ? null : window.localStorage.getItem("partcanvas.files");
    if (!shared && !saved && !savedFiles) return;
    const timeout = window.setTimeout(() => {
      if (shared) {
        setSource(shared.source);
        setParameters(shared.parameters);
        setProjectFiles(shared.files ?? {});
      } else if (saved) setSource(saved);
      if (!shared && savedFiles) {
        try { setProjectFiles(JSON.parse(savedFiles) as Record<string, string>); } catch { /* Ignore corrupt local drafts. */ }
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [initialModel]);

  const compile = useCallback(() => {
    setCompiling(true);
    try {
      const next = compileScad(source, { parameters, files: projectFiles, outputDimension: "auto" });
      setResult(next);
      setError(next.geometry ? null : "The script did not produce geometry.");
    } catch (compileError) {
      setError(compileError instanceof Error ? compileError.message : "Compilation failed");
    } finally {
      setCompiling(false);
    }
  }, [source, parameters, projectFiles]);

  const effectiveExportFormat: ExportFormat = result?.dimension === 2
    ? (["svg", "dxf"].includes(exportFormat) ? exportFormat : "svg")
    : (["stl", "obj", "3mf", "step"].includes(exportFormat) ? exportFormat : "stl");

  useEffect(() => {
    const timeout = window.setTimeout(compile, 320);
    window.localStorage.setItem("partcanvas.source", source);
    window.localStorage.setItem("partcanvas.files", JSON.stringify(projectFiles));
    return () => window.clearTimeout(timeout);
  }, [compile, source, projectFiles]);

  const chooseExample = (index: number) => {
    const example = EXAMPLES[index];
    setSource(example.source);
    setModelName(example.name);
    setParameters(defaultParameterValues(extractParameters(example.source)));
    setProjectFiles({});
    setSelectedPreset("");
    setActiveFile("main.scad");
    setShowExamples(false);
  };

  const downloadModel = () => {
    if (!result?.geometry) return;
    const serialized = serializeGeometry(effectiveExportFormat === "3mf" ? result.parts : result.geometry, effectiveExportFormat, modelName || "partcanvas-model");
    const data = serialized.data;
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: serialized.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `partcanvas-model.${serialized.extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const shareModel = async () => {
    const encoded = encodeSharedModel({ source, parameters, files: projectFiles });
    const url = `${window.location.origin}${window.location.pathname}?model=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Model link copied");
    } catch {
      setNotice("Could not access the clipboard");
    }
    window.setTimeout(() => setNotice(null), 2200);
  };

  const publishModel = async () => {
    if (!result?.geometry || result.dimension !== 3 || publishing) return;
    // Publishing requires an account (D6); Share links stay anonymous.
    if (!authSession?.user) {
      setNotice("Sign in to publish — Share links work without an account");
      window.setTimeout(() => setNotice(null), 2600);
      return;
    }
    setPublishError(null);
    setShowPublishDialog(true);
  };

  const publishOwnedModel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const response = await fetch("/api/app/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: modelName,
          source,
          files: projectFiles,
          parameters,
          description: publishDescription,
          license: publishLicense,
          visibility: publishVisibility,
          tags: publishTags.split(",").map((tag) => tag.trim()).filter(Boolean),
          thumbnail: thumbnailCaptureRef.current?.() ?? undefined,
        }),
      });
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || "Could not publish model");
      setShowPublishDialog(false);
      router.push(payload.url);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Could not publish model");
    } finally {
      setPublishing(false);
    }
  };

  const dimensions = result?.metrics.dimensions;
  const editableFiles = Object.keys(projectFiles).filter(isEditableProjectFile).sort();
  const assetFiles = Object.keys(projectFiles).filter((name) => !isEditableProjectFile(name)).sort();
  const activeSource = activeFile === "main.scad" ? source : projectFiles[activeFile] ?? "";
  const updateActiveSource = (value: string) => {
    if (activeFile === "main.scad") setSource(value);
    else setProjectFiles((current) => ({ ...current, [activeFile]: value }));
    setSelectedPreset("");
  };
  const applyParameterPreset = (key: string) => {
    const preset = parameterPresets.find((candidate) => candidate.key === key);
    setSelectedPreset(key);
    setParameters(preset ? { ...defaultParameterValues(definitions), ...preset.values } : defaultParameterValues(definitions));
    if (preset) {
      setNotice(`Preset “${preset.name}” applied`);
      window.setTimeout(() => setNotice(null), 2200);
    }
  };
  const createLibrary = () => {
    let index = Object.keys(projectFiles).length + 1;
    let name = `library-${index}.scad`;
    while (projectFiles[name] !== undefined) name = `library-${++index}.scad`;
    setProjectFiles((current) => ({ ...current, [name]: "// Reusable modules and functions\n" }));
    setActiveFile(name);
  };
  const consoleItems = [
    ...(result?.messages.map((message) => ({ kind: "message", text: message })) ?? []),
    ...(result?.warnings.map((message) => ({ kind: "warning", text: message })) ?? []),
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <button className="mobile-menu" aria-label="Open menu"><Menu size={19} /></button>
          <a className="brand" href="#" aria-label="partcanvas.io home">
            <span className="brand-mark"><Box size={18} strokeWidth={2.2} /></span>
            <span>partcanvas<span>.io</span></span>
          </a>
          <span className="beta-badge">ALPHA</span>
          <input className="model-name-input" aria-label="Model name" maxLength={80} value={modelName} onChange={(event) => setModelName(event.target.value)} />
        </div>
        <nav className="top-actions">
          <div className="example-picker">
            <button className="ghost-button" onClick={() => setShowExamples((value) => !value)}>
              <Braces size={15} /> Examples <ChevronDown size={14} />
            </button>
            {showExamples && (
              <div className="example-menu">
                <span className="menu-label">START FROM AN EXAMPLE</span>
                {EXAMPLES.map((example, index) => (
                  <button key={example.id} onClick={() => chooseExample(index)}>
                    <span className="example-icon"><Box size={16} /></span>
                    <span><strong>{example.name}</strong><small>{example.description}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <a className="ghost-button docs-button api-link" href="/docs/api"><Code2 size={15} /> API</a>
          <a className="icon-button github-link" href="https://github.com/richrice/partcanvas.io" target="_blank" rel="noreferrer" aria-label="partcanvas.io source code on GitHub"><Github size={17} /></a>
          <button className="ghost-button share-button" onClick={shareModel}><Share2 size={15} /> Share</button>
          <button className="ghost-button publish-button" onClick={publishModel} disabled={!result?.geometry || result.dimension !== 3 || compiling || publishing}><CloudUpload size={15} /> {publishing ? "Publishing…" : "Publish"}</button>
          <button className="primary-button" onClick={downloadModel} disabled={!result?.geometry || compiling}>
            <Download size={16} /> Export {effectiveExportFormat.toUpperCase()}
          </button>
          <AuthMenu />
          <button className="icon-button"><MoreHorizontal size={18} /></button>
        </nav>
      </header>

      {social && (
        <div className="social-bar">
          <div className="social-main">
            <strong className="social-title">{social.title}</strong>
            <span className="social-author">by <a href={`/u/${social.authorUsername}`}>{social.authorUsername}</a></span>
            {social.description ? <span className="social-description" title={social.description}>{social.description}</span> : null}
          </div>
          <div className="social-actions">
            {social.tags.slice(0, 4).map((tag) => <span className="social-tag" key={tag}>{tag}</span>)}
            <span className="license-badge" title="License">{social.license}</span>
            <button className="ghost-button social-count" disabled title="Likes coming soon"><Heart size={14} /> {social.likeCount}</button>
            <button className="ghost-button social-count" disabled title="Forking coming soon"><GitFork size={14} /> Fork</button>
            <span className="social-count-static" title="Downloads"><Download size={14} /> {social.downloadCount}</span>
          </div>
        </div>
      )}

      <div className="mobile-tabs">
        {(["code", "preview", "parameters"] as const).map((panel) => (
          <button className={mobilePanel === panel ? "active" : ""} onClick={() => setMobilePanel(panel)} key={panel}>{panel}</button>
        ))}
      </div>

      <section className="workspace">
        <div className={`workspace-panel editor-panel ${mobilePanel === "code" ? "mobile-active" : ""}`}>
          <div className="panel-toolbar">
            <div className="file-tab" title={modelName}><span className="language-icon">S</span><select aria-label="Active project file" value={activeFile} onChange={(event) => setActiveFile(event.target.value)}><option value="main.scad">main.scad</option>{editableFiles.map((name) => <option value={name} key={name}>{name}</option>)}</select>{assetFiles.length ? <span className="asset-count" title={`Imported assets: ${assetFiles.join(", ")}`}>{assetFiles.length} asset{assetFiles.length === 1 ? "" : "s"}</span> : null}{initialModel?.hostedId ? <span className="hosted-dot" title="Hosted model" /> : <span className="unsaved-dot" />}</div>
            <div className="toolbar-actions">
              <input
                ref={uploadRef}
                hidden
                type="file"
                multiple
                accept=".scad,.stl,.obj,.svg,.dxf,.dat,.png,.json,text/plain,application/json,image/svg+xml,image/png,model/stl,application/dxf"
                onChange={async (event) => {
                  const uploads = [...(event.target.files ?? [])];
                  const contents = await Promise.all(uploads.map(async (file) => ({ name: file.name, source: await readProjectFile(file) })));
                  const scadFiles = contents.filter((file) => isEditableProjectFile(file.name));
                  setSelectedPreset("");
                  if (!scadFiles.length && contents.length) {
                    setProjectFiles((current) => ({ ...current, ...Object.fromEntries(contents.map((file) => [file.name, file.source])) }));
                    setNotice(`${contents.length} model asset${contents.length === 1 ? "" : "s"} added`);
                    window.setTimeout(() => setNotice(null), 2200);
                  } else if (contents.length === 1) {
                    setSource(contents[0].source);
                    setModelName(contents[0].name.replace(/\.scad$/i, "") || "Imported model");
                    setActiveFile("main.scad");
                  } else if (contents.length > 1) {
                    const main = scadFiles.find((file) => file.name.toLowerCase() === "main.scad") ?? scadFiles[0];
                    setSource(main.source);
                    setModelName(main.name.replace(/\.scad$/i, "") || "Imported model");
                    setProjectFiles(Object.fromEntries(contents.filter((file) => file !== main).map((file) => [file.name, file.source])));
                    setActiveFile("main.scad");
                  }
                  event.target.value = "";
                }}
              />
              <button title="New library file" onClick={createLibrary}><FilePlus2 size={15} /></button>
              <button title="Open SCAD, mesh, vector, heightmap, or Customizer JSON project files" onClick={() => uploadRef.current?.click()}><Upload size={15} /></button>
              <button className="run-button" onClick={compile}><CirclePlay size={15} fill="currentColor" /> Run</button>
            </div>
          </div>
          <CodeEditor
            value={activeSource}
            onChange={updateActiveSource}
            onCursorChange={setCursorLocation}
            projectSources={editableFiles.filter((name) => name !== activeFile).map((name) => projectFiles[name])}
            projectFiles={Object.keys(projectFiles)}
          />
          <div className="editor-statusbar">
            <span><Check size={12} /> OpenSCAD compatible</span>
            <span>Ln {cursorLocation.line}, Col {cursorLocation.column}</span>
            <span>Spaces: 2</span>
            <span>UTF-8</span>
          </div>
        </div>

        <div className={`workspace-panel preview-panel ${mobilePanel === "preview" ? "mobile-active" : ""}`}>
          <div className="panel-toolbar preview-toolbar">
            <div className="view-tabs"><button className="active"><Box size={14} /> Perspective</button><button>Top</button><button>Front</button><button>Right</button></div>
            <div className="toolbar-actions">
              <button className={wireframe ? "active-tool" : ""} onClick={() => setWireframe((value) => !value)} title="Toggle wireframe"><Braces size={15} /></button>
              <button className={autoRotate ? "active-tool" : ""} onClick={() => setAutoRotate((value) => !value)} title="Auto rotate"><Rotate3D size={15} /></button>
              <button title="Fit view" onClick={() => setFitViewRequest((request) => request + 1)}><Maximize2 size={15} /></button>
            </div>
          </div>
          <div className="viewport-wrap">
            <ModelViewport geometries={result?.parts ?? []} wireframe={wireframe} autoRotate={autoRotate} fitViewRequest={fitViewRequest} captureRef={thumbnailCaptureRef} />
            <div className={`render-status ${error ? "error" : ""}`}>
              {compiling ? <><LoaderCircle className="spinner" size={14} /> Compiling…</> : error ? <><TriangleAlert size={14} /> {error}</> : <><span className="status-dot" /> Ready</>}
            </div>
            {dimensions && (
              <div className="dimension-card">
                <span>MODEL SIZE</span>
                <strong>{result?.dimension === 2 ? `${format(dimensions[0])} × ${format(dimensions[1])}` : `${format(dimensions[0])} × ${format(dimensions[1])} × ${format(dimensions[2])}`} <small>mm</small></strong>
              </div>
            )}
            <div className="viewport-hint">Drag to orbit · Scroll to zoom · Shift + drag to pan</div>
          </div>
          <div className="console-panel">
            <div className="console-header">
              <span><TerminalSquare size={13} /> Console</span>
              <span className={error ? "console-errors" : "console-clear"}>{error ? "1 error" : result?.warnings.length ? `${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}` : "No errors"}</span>
              <span className="console-spacer" />
              {result?.metrics.triangles ? <span>{result.metrics.triangles.toLocaleString()} triangles</span> : null}
              {result?.metrics.compileMs !== undefined ? <span>{result.metrics.compileMs.toFixed(0)} ms</span> : null}
            </div>
            <div className="console-body">
              {error ? <div className="console-line error-line"><TriangleAlert size={13} />{error}</div> : null}
              {consoleItems.map((item, index) => <div className={`console-line ${item.kind}`} key={`${item.text}-${index}`}>{item.kind === "warning" ? "WARNING:" : "ECHO:"} {item.text}</div>)}
              {!error && !consoleItems.length && <div className="console-line success-line"><Check size={13} /> Model compiled successfully. Ready to export.</div>}
            </div>
          </div>
        </div>

        <aside className={`workspace-panel customizer-panel ${mobilePanel === "parameters" ? "mobile-active" : ""}`}>
          <ParameterPanel
            parameters={definitions}
            values={parameters}
            presets={parameterPresets}
            selectedPreset={visibleSelectedPreset}
            onPresetChange={applyParameterPreset}
            onChange={(name, value) => {
              setSelectedPreset("");
              setParameters((current) => ({ ...current, [name]: value }));
            }}
            onReset={() => {
              setSelectedPreset("");
              setParameters(defaultParameterValues(definitions));
            }}
          />
          <div className="print-summary">
            <div><span>{result?.dimension === 2 ? "AREA" : "EST. VOLUME"}</span><strong>{result?.dimension === 2 && result.metrics.area !== null ? `${format(result.metrics.area)} mm²` : result?.metrics.volume ? `${format(result.metrics.volume / 1000)} cm³` : "—"}</strong></div>
            <div><span>FORMAT</span><select aria-label="Export format" className="format-select" value={effectiveExportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>{result?.dimension === 2 ? <><option value="svg">SVG</option><option value="dxf">AutoCAD DXF</option></> : <><option value="stl">Binary STL</option><option value="step">STEP (faceted B-rep)</option><option value="3mf">BambuStudio 3MF (colors)</option><option value="obj">Wavefront OBJ</option></>}</select></div>
          </div>
          <button className="export-large" onClick={downloadModel} disabled={!result?.geometry || compiling}>
            <span><Download size={19} /> Download {effectiveExportFormat.toUpperCase()}</span>
            <small>{effectiveExportFormat === "3mf" ? "Includes filament color assignments" : "Generated locally in your browser"}</small>
          </button>
        </aside>
      </section>
      {notice && <div className="app-toast"><Check size={14} /> {notice}</div>}
      {showPublishDialog && (
        <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPublishDialog(false); }}>
          <form className="welcome-card publish-dialog" onSubmit={publishOwnedModel}>
            <h1>Publish model</h1>
            <label className="publish-field">
              <span>Title</span>
              <input aria-label="Model title" maxLength={80} value={modelName} onChange={(event) => setModelName(event.target.value)} required />
            </label>
            <label className="publish-field">
              <span>Description</span>
              <textarea aria-label="Model description" maxLength={1000} rows={3} value={publishDescription} onChange={(event) => setPublishDescription(event.target.value)} placeholder="What does it print, and how is it customized?" />
            </label>
            <div className="publish-row">
              <label className="publish-field">
                <span>License</span>
                <select aria-label="License" value={publishLicense} onChange={(event) => setPublishLicense(event.target.value as License)}>
                  {LICENSES.map((license) => <option key={license} value={license}>{license}</option>)}
                </select>
              </label>
              <label className="publish-field">
                <span>Visibility</span>
                <select aria-label="Visibility" value={publishVisibility} onChange={(event) => setPublishVisibility(event.target.value as Visibility)}>
                  {VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{visibility}</option>)}
                </select>
              </label>
            </div>
            <label className="publish-field">
              <span>Tags <small>(comma separated, up to 12)</small></span>
              <input aria-label="Tags" value={publishTags} onChange={(event) => setPublishTags(event.target.value)} placeholder="gears, robotics" />
            </label>
            {publishError && <span className="welcome-problem"><TriangleAlert size={13} /> {publishError}</span>}
            <div className="publish-row">
              <button type="button" className="ghost-button" onClick={() => setShowPublishDialog(false)}>Cancel</button>
              <button className="primary-button" type="submit" disabled={publishing || !modelName.trim()}>
                {publishing ? <><LoaderCircle className="spinner" size={15} /> Publishing…</> : <><CloudUpload size={15} /> Publish</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
