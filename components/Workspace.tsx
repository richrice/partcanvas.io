"use client";

import {
  Box,
  Braces,
  Check,
  ChevronDown,
  CirclePlay,
  CloudUpload,
  Code2,
  Compass,
  Download,
  Eye,
  FilePlus2,
  Flag,
  GitFork,
  Github,
  Heart,
  History,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Pencil,
  Rotate3D,
  Send,
  Share2,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthMenu } from "./AuthMenu";
import { CodeEditor, type CursorLocation } from "./CodeEditor";
import { ModelViewport, type ViewPreset } from "./ModelViewport";
import { ParameterPanel } from "./ParameterPanel";
import { compileScadCached, CompileSupersededError, type CompileCacheTier } from "@/lib/compile-cache";
import { serializeGeometry, type CompileResult, type ExportFormat } from "@/lib/scad/compiler";
import { DEFAULT_SOURCE, EXAMPLES } from "@/lib/scad/examples";
import { defaultParameterValues, extractParameters, type ParameterValue } from "@/lib/scad/parameters";
import { extensionOf, isEditableProjectFile, readProjectFile } from "@/lib/project-assets";
import { resolveSourceFiles } from "@/lib/scad/files";
import { inspectOpenScadParameterSets, loadOpenScadParameterFile } from "@/lib/scad/parameter-sets";
import { authClient } from "@/lib/auth/client";
import { LICENSES, VISIBILITIES, type License, type Visibility } from "@/lib/models/types";
import { relativeTime } from "@/lib/relative-time";
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
  commentCount: number;
  viewCount: number;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  viewerLiked: boolean;
  forkedFrom?: { title: string; author: string; url: string };
  forkCount: number;
  forks: { title: string; author: string; url: string }[];
  viewerIsOwner: boolean;
  versions: { version: number; revisionId: string; publishedAt: string }[];
}

export interface ModelComment {
  id: string;
  body: string;
  createdAt: string;
  author: { username: string | null; name: string; image: string | null };
  viewerIsAuthor: boolean;
}

// Revision permalinks (/m/:id) link back to the community model page whose
// head this revision is (P3.7).
export interface RevisionOfModel {
  title: string;
  author: string;
  url: string;
  // Set when this revision is a historical version rather than the head.
  version?: number;
}

export function Workspace({ initialModel, social, revisionOf }: { initialModel?: InitialWorkspaceModel; social?: SocialChromeModel; revisionOf?: RevisionOfModel }) {
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
  const [viewRequest, setViewRequest] = useState<{ view: ViewPreset; nonce: number }>({ view: "perspective", nonce: 0 });
  const chooseView = (view: ViewPreset) => setViewRequest((current) => ({ view, nonce: current.nonce + 1 }));
  // Manual orbiting (or auto-rotate) leaves any standard view, so the tab bar
  // falls back to highlighting Perspective instead of lying about the camera.
  const leaveStandardView = useCallback(() => {
    setViewRequest((current) => current.view === "perspective" ? current : { view: "perspective", nonce: 0 });
  }, []);
  const [showExamples, setShowExamples] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("stl");
  const [mobilePanel, setMobilePanel] = useState<"code" | "preview" | "parameters">("preview");
  const [notice, setNotice] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishDescription, setPublishDescription] = useState("");
  const [publishLicense, setPublishLicense] = useState<License>("CC-BY-4.0");
  const [publishVisibility, setPublishVisibility] = useState<Visibility>("public");
  const [publishTags, setPublishTags] = useState("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [liked, setLiked] = useState(social?.viewerLiked ?? false);
  const [likeCount, setLikeCount] = useState(social?.likeCount ?? 0);
  const [downloadCount, setDownloadCount] = useState(social?.downloadCount ?? 0);
  const { data: authSession } = authClient.useSession();
  const router = useRouter();
  const [cursorLocation, setCursorLocation] = useState<CursorLocation>({ line: 1, column: 1 });
  const uploadRef = useRef<HTMLInputElement>(null);
  const thumbnailCaptureRef = useRef<(() => string | null) | null>(null);
  // One shared toast pipeline: later notices replace earlier ones instead of
  // being clipped by a stale timer, and errors render distinctly from success.
  const noticeTimer = useRef<number | null>(null);
  const showNotice = useCallback((text: string, kind: "success" | "error" = "success", duration = 2400) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice({ text, kind });
    noticeTimer.current = window.setTimeout(() => setNotice(null), duration);
  }, []);
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

  // Compiles resolve asynchronously (the cache's persistent tier is async),
  // so a run counter drops stale completions when the source or parameters
  // changed again mid-flight.
  const compileRun = useRef(0);
  const [resultFromCache, setResultFromCache] = useState<CompileCacheTier>(false);
  const compile = useCallback(() => {
    const run = ++compileRun.current;
    setCompiling(true);
    void compileScadCached(source, { parameters, files: projectFiles, outputDimension: "auto" })
      .then(({ result: next, fromCache }) => {
        if (run !== compileRun.current) return;
        setResult(next);
        setResultFromCache(fromCache);
        setError(next.geometry ? null : "The script did not produce geometry.");
      })
      .catch((compileError: unknown) => {
        if (run !== compileRun.current) return;
        // A superseded compile means a newer run owns the UI state already.
        if (compileError instanceof CompileSupersededError) return;
        setResultFromCache(false);
        setError(compileError instanceof Error ? compileError.message : "Compilation failed");
      })
      .finally(() => {
        if (run === compileRun.current) setCompiling(false);
      });
  }, [source, parameters, projectFiles]);

  const effectiveExportFormat: ExportFormat = result?.dimension === 2
    ? (["svg", "dxf"].includes(exportFormat) ? exportFormat : "svg")
    : (["stl", "obj", "3mf", "step"].includes(exportFormat) ? exportFormat : "stl");

  useEffect(() => {
    const timeout = window.setTimeout(compile, 320);
    // The local draft belongs to /new only — hosted model pages must never
    // overwrite it just because they were viewed.
    if (!initialModel) {
      window.localStorage.setItem("partcanvas.source", source);
      window.localStorage.setItem("partcanvas.files", JSON.stringify(projectFiles));
    }
    return () => window.clearTimeout(timeout);
  }, [compile, source, projectFiles, initialModel]);

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
    // Fire-and-forget download beacon for hosted model pages (P3.6).
    if (social) {
      setDownloadCount((count) => count + 1);
      void fetch(`/api/models/${social.modelId}/download`, { method: "POST", keepalive: true }).catch(() => undefined);
    }
    const serialized = serializeGeometry(effectiveExportFormat === "3mf" ? result.parts : result.geometry, effectiveExportFormat, modelName || "partcanvas-model");
    const data = serialized.data;
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: serialized.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const filename = modelName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "partcanvas-model";
    anchor.download = `${filename}.${serialized.extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const shareModel = async () => {
    const encoded = encodeSharedModel({ source, parameters, files: projectFiles });
    // Always target /new: hosted model pages ignore ?model= (initialModel wins
    // there), so a share link must land where the payload is actually read.
    const url = `${window.location.origin}/new?model=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      showNotice("Model link copied");
    } catch {
      showNotice("Could not access the clipboard", "error");
    }
  };

  const publishModel = async () => {
    if (!result?.geometry || result.dimension !== 3 || publishing) return;
    // Publishing requires an account (D6); Share links stay anonymous.
    if (!authSession?.user) {
      showNotice("Sign in to publish — Share links work without an account", "error", 2600);
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
      const draft = {
        name: modelName,
        source,
        files: projectFiles,
        parameters,
        thumbnail: thumbnailCaptureRef.current?.() ?? undefined,
      };
      if (social?.viewerIsOwner && publishMode === "update") {
        const response = await fetch(`/api/app/models/${social.modelId}/versions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        const payload = await response.json() as { version?: number; error?: string };
        if (!response.ok || !payload.version) throw new Error(payload.error || "Could not publish the update");
        setShowPublishDialog(false);
        showNotice(`Version ${payload.version} published`, "success", 2600);
        router.refresh();
        return;
      }
      const response = await fetch("/api/app/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          description: publishDescription,
          license: publishLicense,
          visibility: publishVisibility,
          tags: publishTags.split(",").map((tag) => tag.trim()).filter(Boolean),
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

  const [forking, setForking] = useState(false);
  const [showForks, setShowForks] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);
  const [publishMode, setPublishMode] = useState<"update" | "new">(social?.viewerIsOwner ? "update" : "new");
  const forkCurrentModel = async () => {
    if (!social || forking) return;
    if (!authSession?.user) {
      showNotice("Sign in to fork models", "error");
      return;
    }
    setForking(true);
    try {
      const response = await fetch(`/api/app/models/${social.modelId}/fork`, { method: "POST" });
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || "Could not fork model");
      router.push(payload.url);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not fork model", "error", 2600);
      setForking(false);
    }
  };

  const submitReport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!social || reporting) return;
    setReporting(true);
    try {
      const response = await fetch(`/api/models/${social.modelId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reportReason }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Could not send the report");
      }
      setShowReport(false);
      setReportReason("");
      showNotice("Report sent — thank you", "success", 2600);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not send the report", "error", 2600);
    } finally {
      setReporting(false);
    }
  };

  const likePending = useRef(false);
  const toggleLike = async () => {
    if (!social || likePending.current) return;
    if (!authSession?.user) {
      showNotice("Sign in to like models", "error");
      return;
    }
    // Optimistic flip, reconciled from (or rolled back by) the server.
    likePending.current = true;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((count) => count + (nextLiked ? 1 : -1));
    try {
      const response = await fetch(`/api/app/models/${social.modelId}/like`, { method: "POST" });
      const payload = await response.json() as { liked?: boolean; likeCount?: number; error?: string };
      if (!response.ok || payload.liked === undefined || payload.likeCount === undefined) throw new Error(payload.error);
      setLiked(payload.liked);
      setLikeCount(payload.likeCount);
    } catch (error) {
      setLiked(!nextLiked);
      setLikeCount((count) => count + (nextLiked ? -1 : 1));
      showNotice(error instanceof Error && error.message ? error.message : "Could not update the like", "error");
    } finally {
      likePending.current = false;
    }
  };

  // Comments drawer (adversarial-review P0: the community had no discussion
  // surface at all). Loaded lazily on first open.
  const [showDrawer, setShowDrawer] = useState(false);
  const [commentCount, setCommentCount] = useState(social?.commentCount ?? 0);
  const [commentsData, setCommentsData] = useState<ModelComment[] | null>(null);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsPage, setCommentsPage] = useState(1);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [viewerCanModerate, setViewerCanModerate] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  const loadComments = useCallback(async (page = 1) => {
    if (!social) return;
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      const response = await fetch(`/api/app/models/${social.modelId}/comments?page=${page}`);
      const payload = await response.json() as { comments?: ModelComment[]; commentCount?: number; hasMore?: boolean; viewerCanModerate?: boolean; error?: string };
      if (!response.ok || !payload.comments) throw new Error(payload.error || "Could not load comments");
      const loaded = payload.comments;
      setCommentsData((current) => page === 1 ? loaded : [...(current ?? []), ...loaded]);
      setCommentsPage(page);
      setCommentsHasMore(payload.hasMore ?? false);
      setCommentCount(payload.commentCount ?? 0);
      setViewerCanModerate(payload.viewerCanModerate ?? false);
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : "Could not load comments");
    } finally {
      setCommentsLoading(false);
    }
  }, [social]);

  const toggleDrawer = () => {
    setShowDrawer((open) => {
      if (!open && commentsData === null) void loadComments();
      return !open;
    });
  };

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!social || postingComment || !commentDraft.trim()) return;
    if (!authSession?.user) {
      showNotice("Sign in to comment", "error");
      return;
    }
    setPostingComment(true);
    try {
      const response = await fetch(`/api/app/models/${social.modelId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: commentDraft }),
      });
      const payload = await response.json() as { comment?: ModelComment; error?: string };
      if (!response.ok || !payload.comment) throw new Error(payload.error || "Could not post the comment");
      const posted = payload.comment;
      setCommentsData((current) => [posted, ...(current ?? [])]);
      setCommentCount((count) => count + 1);
      setCommentDraft("");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not post the comment", "error", 2600);
    } finally {
      setPostingComment(false);
    }
  };

  const removeComment = async (commentId: string) => {
    if (!social) return;
    try {
      const response = await fetch(`/api/app/models/${social.modelId}/comments/${commentId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { commentCount?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not delete the comment");
      setCommentsData((current) => (current ?? []).filter((comment) => comment.id !== commentId));
      if (payload.commentCount !== undefined) setCommentCount(payload.commentCount);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Could not delete the comment", "error");
    }
  };

  // Owner metadata editing + deletion over the long-existing PATCH/DELETE
  // endpoints that previously had no UI (adversarial-review P0).
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLicense, setEditLicense] = useState<License>("CC-BY-4.0");
  const [editVisibility, setEditVisibility] = useState<Visibility>("public");
  const [editTags, setEditTags] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingModel, setDeletingModel] = useState(false);

  // Popovers close on outside click and Escape; dialogs close on Escape.
  // (Backdrop clicks already close the dialogs via their overlay handlers.)
  const anyMenuOpen = showExamples || showVersions || showForks || showReport;
  useEffect(() => {
    if (!anyMenuOpen) return;
    const close = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.(".example-picker")) return;
      setShowExamples(false);
      setShowVersions(false);
      setShowForks(false);
      setShowReport(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [anyMenuOpen]);
  useEffect(() => {
    if (!anyMenuOpen && !showPublishDialog && !showEditDialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowExamples(false);
      setShowVersions(false);
      setShowForks(false);
      setShowReport(false);
      setShowPublishDialog(false);
      setShowEditDialog(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyMenuOpen, showPublishDialog, showEditDialog]);

  const openEditDialog = () => {
    if (!social) return;
    setEditTitle(social.title);
    setEditDescription(social.description);
    setEditLicense(social.license);
    setEditVisibility(social.visibility);
    setEditTags(social.tags.join(", "));
    setEditError(null);
    setConfirmingDelete(false);
    setShowEditDialog(true);
  };

  const saveModelEdits = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!social || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/app/models/${social.modelId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          license: editLicense,
          visibility: editVisibility,
          tags: editTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save the changes");
      setShowEditDialog(false);
      setModelName(editTitle.trim() || modelName);
      showNotice("Model details saved");
      router.refresh();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not save the changes");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteThisModel = async () => {
    if (!social || deletingModel) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeletingModel(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/app/models/${social.modelId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Could not delete the model");
      }
      router.push(`/u/${social.authorUsername}`);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not delete the model");
      setDeletingModel(false);
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
    if (preset) showNotice(`Preset “${preset.name}” applied`);
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
          <Link className="brand" href="/" aria-label="partcanvas.io home">
            <span className="brand-mark"><Box size={18} strokeWidth={2.2} /></span>
            <span>partcanvas<span>.io</span></span>
          </Link>
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
          <Link className="ghost-button explore-link" href="/"><Compass size={15} /> Explore</Link>
          <a className="ghost-button docs-button api-link" href="/docs/api"><Code2 size={15} /> API</a>
          <a className="icon-button github-link" href="https://github.com/richrice/partcanvas.io" target="_blank" rel="noreferrer" aria-label="partcanvas.io source code on GitHub"><Github size={17} /></a>
          <button className="ghost-button share-button" onClick={shareModel}><Share2 size={15} /> Share</button>
          <button
            className="ghost-button publish-button"
            onClick={publishModel}
            disabled={!result?.geometry || result.dimension !== 3 || compiling || publishing}
            title={result?.dimension === 2
              ? "2D sketches can be shared and exported, but only 3D models can be published"
              : result?.geometry ? "Publish to the community gallery" : "Fix the script so it produces geometry, then publish"}
          ><CloudUpload size={15} /> {publishing ? "Publishing…" : "Publish"}</button>
          <button className="primary-button" onClick={downloadModel} disabled={!result?.geometry || compiling}>
            <Download size={16} /> Export {effectiveExportFormat.toUpperCase()}
          </button>
          <AuthMenu />
        </nav>
      </header>

      {revisionOf && !social && (
        <div className="social-bar revision-bar">
          <div className="social-main">
            <span className="social-author">Permanent snapshot{revisionOf.version ? ` of v${revisionOf.version}` : ""} of <a href={revisionOf.url}>{revisionOf.title}</a> by <a href={`/u/${revisionOf.author}`}>{revisionOf.author}</a></span>
          </div>
          <div className="social-actions">
            <a className="ghost-button" href={revisionOf.url}>View model page →</a>
          </div>
        </div>
      )}
      {social && (
        <div className="social-bar">
          <div className="social-main">
            <strong className="social-title">{social.title}</strong>
            <span className="social-author">by <a href={`/u/${social.authorUsername}`}>{social.authorUsername}</a></span>
            {social.forkedFrom && (
              <span className="social-author social-lineage">forked from <a href={social.forkedFrom.url}>{social.forkedFrom.title}</a> by <a href={`/u/${social.forkedFrom.author}`}>{social.forkedFrom.author}</a></span>
            )}
            {social.description ? <span className="social-description" title={social.description}>{social.description}</span> : null}
          </div>
          <div className="social-actions">
            {social.tags.slice(0, 4).map((tag) => <Link className="social-tag" key={tag} href={`/?tag=${encodeURIComponent(tag)}`} title={`Browse #${tag} models`}>{tag}</Link>)}
            {social.tags.length > 4 ? <span className="social-tag" title={social.tags.slice(4).join(", ")}>+{social.tags.length - 4}</span> : null}
            <span className="license-badge" title="License">{social.license}</span>
            <button className={`ghost-button social-count ${liked ? "liked" : ""}`} onClick={toggleLike} title={liked ? "Unlike" : "Like"}>
              <Heart size={14} fill={liked ? "currentColor" : "none"} /> {likeCount}
            </button>
            <button className={`ghost-button social-count ${showDrawer ? "drawer-open" : ""}`} onClick={toggleDrawer} title="Comments and details">
              <MessageSquare size={14} /> {commentCount}
            </button>
            <button className="ghost-button social-count" onClick={forkCurrentModel} disabled={forking} title="Fork this model into your account">
              {forking ? <LoaderCircle className="spinner" size={14} /> : <GitFork size={14} />} Fork
            </button>
            {social.versions.length > 0 && (
              <div className="example-picker">
                <button className="ghost-button social-count" onClick={() => setShowVersions((value) => !value)} title="Version history">
                  <History size={14} /> v{social.versions[0].version} <ChevronDown size={13} />
                </button>
                {showVersions && (
                  <div className="example-menu auth-dropdown">
                    <span className="menu-label">VERSION HISTORY</span>
                    {social.versions.map((entry) => (
                      <a className="auth-menu-link" key={entry.version} href={`/m/${entry.revisionId}`}>
                        <History size={15} /> v{entry.version} <small>{new Date(entry.publishedAt).toLocaleDateString()}</small>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
            {social.forkCount > 0 && (
              <div className="example-picker">
                <button className="ghost-button social-count" onClick={() => setShowForks((value) => !value)} title="Public forks of this model">
                  {social.forkCount} fork{social.forkCount === 1 ? "" : "s"} <ChevronDown size={13} />
                </button>
                {showForks && (
                  <div className="example-menu auth-dropdown">
                    <span className="menu-label">PUBLIC FORKS</span>
                    {social.forks.map((fork) => (
                      <a className="auth-menu-link" key={fork.url} href={fork.url}><GitFork size={15} /> {fork.title} <small>by {fork.author}</small></a>
                    ))}
                  </div>
                )}
              </div>
            )}
            <span className="social-count-static" title="Downloads"><Download size={14} /> {downloadCount}</span>
            <span className="social-count-static" title="Views"><Eye size={14} /> {social.viewCount}</span>
            {social.viewerIsOwner && (
              <button className="ghost-button social-count" onClick={openEditDialog} title="Edit model details">
                <Pencil size={14} />
              </button>
            )}
            <div className="example-picker">
              <button className="ghost-button social-count" onClick={() => setShowReport((value) => !value)} title="Report this model">
                <Flag size={14} />
              </button>
              {showReport && (
                <form className="example-menu auth-dropdown report-menu" onSubmit={submitReport}>
                  <span className="menu-label">REPORT THIS MODEL</span>
                  <textarea
                    aria-label="Report reason"
                    rows={3}
                    maxLength={1000}
                    placeholder="What's wrong? (optional)"
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                  />
                  <button className="primary-button" type="submit" disabled={reporting}>
                    {reporting ? <LoaderCircle className="spinner" size={14} /> : <Flag size={14} />} Send report
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {social && showDrawer && (
        <section className="model-drawer" aria-label="Model details and comments">
          <div className="drawer-about">
            <h3>About</h3>
            <p className={`drawer-description ${social.description ? "" : "drawer-muted"}`}>{social.description || "No description yet."}</p>
            {social.tags.length > 0 && (
              <div className="drawer-tags">
                {social.tags.map((tag) => <Link key={tag} className="social-tag" href={`/?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>)}
              </div>
            )}
            <p className="drawer-meta" suppressHydrationWarning>
              Published {new Date(social.createdAt).toLocaleDateString()} · Updated {relativeTime(social.updatedAt)} · {social.viewCount} view{social.viewCount === 1 ? "" : "s"} · {social.license}
            </p>
          </div>
          <div className="drawer-comments">
            <h3>Comments ({commentCount})</h3>
            {authSession?.user ? (
              <form className="comment-composer" onSubmit={submitComment}>
                <textarea
                  aria-label="Write a comment"
                  rows={2}
                  maxLength={2000}
                  placeholder="Share print results, ask a question…"
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                />
                <button className="primary-button" type="submit" disabled={postingComment || !commentDraft.trim()}>
                  {postingComment ? <LoaderCircle className="spinner" size={14} /> : <Send size={14} />} Post
                </button>
              </form>
            ) : (
              <p className="drawer-muted">Sign in (top right) to join the discussion.</p>
            )}
            {commentsError && (
              <p className="drawer-muted">{commentsError} <button className="ghost-button" onClick={() => void loadComments(1)}>Retry</button></p>
            )}
            {commentsData !== null && commentsData.length === 0 && !commentsLoading && !commentsError && (
              <p className="drawer-muted">No comments yet — start the discussion.</p>
            )}
            <ul className="comment-list">
              {(commentsData ?? []).map((comment) => (
                <li key={comment.id}>
                  <div className="comment-head">
                    {comment.author.username
                      ? <Link href={`/u/${comment.author.username}`}>{comment.author.username}</Link>
                      : <span>{comment.author.name}</span>}
                    <time suppressHydrationWarning title={new Date(comment.createdAt).toLocaleString()}>{relativeTime(comment.createdAt)}</time>
                    {(comment.viewerIsAuthor || viewerCanModerate) && (
                      <button className="comment-delete" onClick={() => void removeComment(comment.id)} title="Delete comment" aria-label="Delete comment">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <p className="comment-body">{comment.body}</p>
                </li>
              ))}
            </ul>
            {commentsLoading && <p className="drawer-muted"><LoaderCircle className="spinner" size={13} /> Loading comments…</p>}
            {commentsHasMore && !commentsLoading && (
              <button className="ghost-button" onClick={() => void loadComments(commentsPage + 1)}>Load more comments</button>
            )}
          </div>
        </section>
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
                    showNotice(`${contents.length} model asset${contents.length === 1 ? "" : "s"} added`);
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
          </div>
        </div>

        <div className={`workspace-panel preview-panel ${mobilePanel === "preview" ? "mobile-active" : ""}`}>
          <div className="panel-toolbar preview-toolbar">
            <div className="view-tabs">
              {(["perspective", "top", "front", "right"] as const).map((view) => (
                <button key={view} className={viewRequest.view === view ? "active" : ""} onClick={() => chooseView(view)}>
                  {view === "perspective" ? <><Box size={14} /> Perspective</> : view[0].toUpperCase() + view.slice(1)}
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <button className={wireframe ? "active-tool" : ""} onClick={() => setWireframe((value) => !value)} title="Toggle wireframe"><Braces size={15} /></button>
              <button className={autoRotate ? "active-tool" : ""} onClick={() => { setAutoRotate((value) => !value); leaveStandardView(); }} title="Auto rotate"><Rotate3D size={15} /></button>
              <button title="Fit view" onClick={() => chooseView(viewRequest.view)}><Maximize2 size={15} /></button>
            </div>
          </div>
          <div className="viewport-wrap">
            <ModelViewport geometries={result?.parts ?? []} wireframe={wireframe} autoRotate={autoRotate} viewRequest={viewRequest} onUserOrbit={leaveStandardView} captureRef={thumbnailCaptureRef} />
            <div className={`render-status ${error ? "error" : ""}`}>
              {compiling ? <><LoaderCircle className="spinner" size={14} /> Compiling…</> : error ? <><TriangleAlert size={14} /> {error}</> : <><span className="status-dot" /> Ready</>}
            </div>
            {dimensions && (
              <div className="dimension-card">
                <span>MODEL SIZE</span>
                <strong>{result?.dimension === 2 ? `${format(dimensions[0])} × ${format(dimensions[1])}` : `${format(dimensions[0])} × ${format(dimensions[1])} × ${format(dimensions[2])}`} <small>mm</small></strong>
              </div>
            )}
            <div className="viewport-hint">Drag to orbit · Scroll to zoom · Right-drag to pan</div>
          </div>
          <div className="console-panel">
            <div className="console-header">
              <span><TerminalSquare size={13} /> Console</span>
              <span className={error ? "console-errors" : "console-clear"}>{error ? "1 error" : result?.warnings.length ? `${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}` : "No errors"}</span>
              <span className="console-spacer" />
              {result?.metrics.triangles ? <span>{result.metrics.triangles.toLocaleString()} triangles</span> : null}
              {result?.metrics.compileMs !== undefined ? <span>{resultFromCache ? "cached" : `${result.metrics.compileMs.toFixed(0)} ms`}</span> : null}
            </div>
            <div className="console-body">
              {error ? <div className="console-line error-line"><TriangleAlert size={13} />{error}</div> : null}
              {consoleItems.map((item, index) => <div className={`console-line ${item.kind}`} key={`${item.text}-${index}`}>{item.kind === "warning" ? "WARNING:" : "ECHO:"} {item.text}</div>)}
              {!error && !consoleItems.length && (result && !compiling
                ? <div className="console-line success-line"><Check size={13} /> Model compiled successfully. Ready to export.</div>
                : <div className="console-line"><LoaderCircle className="spinner" size={13} /> Compiling…</div>)}
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
      {notice && (
        <div className={`app-toast ${notice.kind === "error" ? "toast-error" : ""}`} role="status">
          {notice.kind === "error" ? <TriangleAlert size={14} /> : <Check size={14} />} {notice.text}
        </div>
      )}
      {showPublishDialog && (
        <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPublishDialog(false); }}>
          <form className="welcome-card publish-dialog" onSubmit={publishOwnedModel}>
            <h1>{social?.viewerIsOwner && publishMode === "update" ? "Publish update" : "Publish model"}</h1>
            {social?.viewerIsOwner && (
              <div className="publish-mode" role="radiogroup" aria-label="Publish mode">
                <label>
                  <input type="radio" name="publish-mode" checked={publishMode === "update"} onChange={() => setPublishMode("update")} />
                  Update “{social.title}” (v{(social.versions[0]?.version ?? 1) + 1})
                </label>
                <label>
                  <input type="radio" name="publish-mode" checked={publishMode === "new"} onChange={() => setPublishMode("new")} />
                  Publish as a new model
                </label>
              </div>
            )}
            {/* Update mode republishes content only — the model title is edited
                via the Edit-details dialog, so offering it here would be a
                silent no-op. */}
            {(!social?.viewerIsOwner || publishMode === "new") && (<>
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
            </>)}
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
      {showEditDialog && social && (
        <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowEditDialog(false); }}>
          <form className="welcome-card publish-dialog" onSubmit={saveModelEdits}>
            <h1>Edit model details</h1>
            <label className="publish-field">
              <span>Title</span>
              <input aria-label="Model title" maxLength={80} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required />
            </label>
            <label className="publish-field">
              <span>Description</span>
              <textarea aria-label="Model description" maxLength={1000} rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
            </label>
            <div className="publish-row">
              <label className="publish-field">
                <span>License</span>
                <select aria-label="License" value={editLicense} onChange={(event) => setEditLicense(event.target.value as License)}>
                  {LICENSES.map((license) => <option key={license} value={license}>{license}</option>)}
                </select>
              </label>
              <label className="publish-field">
                <span>Visibility</span>
                <select aria-label="Visibility" value={editVisibility} onChange={(event) => setEditVisibility(event.target.value as Visibility)}>
                  {VISIBILITIES.map((visibility) => <option key={visibility} value={visibility}>{visibility}</option>)}
                </select>
              </label>
            </div>
            <label className="publish-field">
              <span>Tags <small>(comma separated, up to 12)</small></span>
              <input aria-label="Tags" value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="gears, robotics" />
            </label>
            {editError && <span className="welcome-problem"><TriangleAlert size={13} /> {editError}</span>}
            <button type="button" className="ghost-button danger-button" onClick={deleteThisModel} disabled={deletingModel}>
              {deletingModel ? <LoaderCircle className="spinner" size={14} /> : <Trash2 size={14} />}
              {confirmingDelete ? " Really delete? Forks keep their copies. This cannot be undone." : " Delete model"}
            </button>
            <div className="publish-row">
              <button type="button" className="ghost-button" onClick={() => setShowEditDialog(false)}>Cancel</button>
              <button className="primary-button" type="submit" disabled={savingEdit || !editTitle.trim()}>
                {savingEdit ? <><LoaderCircle className="spinner" size={15} /> Saving…</> : <><Check size={15} /> Save changes</>}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
