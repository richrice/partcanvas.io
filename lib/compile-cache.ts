import { compileScad, type CompileOptions, type CompileResult } from "@/lib/scad/compiler";
import type { CompileWorkerRequest, CompileWorkerResponse } from "@/lib/compile-worker";

// Client-side compile cache (UI layer — not part of the isomorphic engine).
// Two tiers keyed by a content hash of the full compile input:
//   1. An in-memory LRU — instant for parameter flip-backs and client-side
//      revisits of a model page within one browser session.
//   2. IndexedDB — slow compiles survive page refreshes. Only results that
//      took meaningful time to compile are persisted; cheap compiles are
//      faster to redo than to round-trip through storage.
// CompileResult is plain structured-cloneable data (JSCAD geometries are
// plain objects of arrays), which is what makes the IDB tier possible.

// Bump when engine semantics change enough that cached geometry would lie.
// v2: real Liberation Sans text() outlines, color-preserving union(),
// OpenSCAD child-node boolean semantics.
// v3: OpenSCAD-compatible str() real-number formatting.
const CACHE_VERSION = 3;
const MEMORY_CAPACITY = 16;
// Persist all but trivial compiles: users expect a refreshed model page to
// load from cache, and even an ~80ms compile is a visible flash on top of
// worker spawn and debounce. Only compiles cheaper than a storage round-trip
// are excluded.
const PERSIST_MIN_COMPILE_MS = 25;
const PERSIST_MAX_ENTRIES = 24;
const PERSIST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DB_NAME = "partcanvas-compile-cache";
const STORE = "compiles";

export type CompileCacheTier = "memory" | "persistent" | false;

export interface CachedCompile {
  result: CompileResult;
  fromCache: CompileCacheTier;
}

// FNV-1a, run twice with different offset bases for a 64-bit-ish key. A
// collision would show the wrong model, so 32 bits alone is not enough.
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function compileCacheKey(source: string, options: CompileOptions): string {
  const canonical = JSON.stringify({
    v: CACHE_VERSION,
    source,
    files: Object.entries(options.files ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    parameters: Object.entries(options.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    fn: options.fn ?? null,
    time: options.time ?? null,
    preview: options.preview ?? null,
    outputDimension: options.outputDimension ?? "3d",
    transform: options.transform ?? null,
  });
  return `${fnv1a(canonical, 0x811c9dc5).toString(16)}-${fnv1a(canonical, 0xcbf29ce4).toString(16)}`;
}

const memoryCache = new Map<string, CompileResult>();

function memoryGet(key: string): CompileResult | undefined {
  const hit = memoryCache.get(key);
  if (hit) {
    // Re-insert so Map iteration order doubles as LRU order.
    memoryCache.delete(key);
    memoryCache.set(key, hit);
  }
  return hit;
}

function memoryPut(key: string, result: CompileResult): void {
  memoryCache.delete(key);
  memoryCache.set(key, result);
  while (memoryCache.size > MEMORY_CAPACITY) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

/** Test hook: clears the in-memory tier. */
export function clearCompileMemoryCache(): void {
  memoryCache.clear();
}

interface PersistedEntry {
  key: string;
  savedAt: number;
  result: CompileResult;
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // A version bump starts a fresh store — stale geometry must not survive.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: "key" }).createIndex("savedAt", "savedAt");
    };
    request.onsuccess = () => resolve(request.result);
    // Private browsing modes and quota failures degrade to compile-only.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function persistentGet(key: string): Promise<CompileResult | null> {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result as PersistedEntry | undefined;
        db.close();
        if (!entry || Date.now() - entry.savedAt > PERSIST_MAX_AGE_MS) resolve(null);
        else resolve(entry.result);
      };
      request.onerror = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function persistentPut(key: string, result: CompileResult): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      store.put({ key, savedAt: Date.now(), result } satisfies PersistedEntry);
      // Prune oldest entries beyond the cap inside the same transaction.
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        let excess = countRequest.result - PERSIST_MAX_ENTRIES;
        if (excess <= 0) return;
        const cursorRequest = store.index("savedAt").openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || excess <= 0) return;
          cursor.delete();
          excess -= 1;
          cursor.continue();
        };
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); resolve(); };
    } catch {
      db.close();
      resolve();
    }
  });
}

// --- Worker execution ---
// Cache misses compile in a Web Worker so heavy CSG never blocks the main
// thread. The worker runs one compile at a time; only the LATEST waiting
// request is kept (older waiters are superseded — the editor only ever wants
// the newest source/parameters). If a stale compile hogs the worker past the
// watchdog window (e.g. a runaway script), the worker is recycled so the
// fresh request still runs. Environments without Worker (SSR, tests) compile
// synchronously on the calling thread.

const WORKER_STALE_TERMINATE_MS = 3000;

/** Rejection marker for compile requests replaced by a newer one. */
export class CompileSupersededError extends Error {
  constructor() {
    super("Compile superseded by a newer request");
    this.name = "CompileSupersededError";
  }
}

interface CompileJob {
  id: number;
  source: string;
  options: CompileOptions;
  resolve: (result: CompileResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
let workerProvenGood = false;
let requestCounter = 0;
let inFlight: CompileJob | null = null;
let inFlightSince = 0;
let queuedJob: CompileJob | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;

function spawnWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./compile-worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<CompileWorkerResponse>) => {
    workerProvenGood = true;
    const job = inFlight;
    inFlight = null;
    if (job && job.id === event.data.id) {
      if (event.data.ok) job.resolve(event.data.result);
      else job.reject(new Error(event.data.error));
    }
    pumpWorker();
  };
  worker.onerror = () => {
    // Script load failure or a hard crash (e.g. out of memory). A worker that
    // never completed anything is treated as unusable — permanent sync
    // fallback — rather than respawn-looping.
    worker?.terminate();
    worker = null;
    if (!workerProvenGood) workerBroken = true;
    const job = inFlight;
    inFlight = null;
    // Never auto-retry the job that likely caused the crash.
    job?.reject(new Error("The compile worker crashed — try simplifying the model."));
    pumpWorker();
  };
  return worker;
}

function pumpWorker(): void {
  if (!queuedJob) return;
  if (inFlight) {
    const heldFor = Date.now() - inFlightSince;
    if (heldFor < WORKER_STALE_TERMINATE_MS) {
      // Wake up when the watchdog window closes in case the compile hung.
      if (watchdog === null) {
        watchdog = setTimeout(() => {
          watchdog = null;
          pumpWorker();
        }, WORKER_STALE_TERMINATE_MS - heldFor);
      }
      return;
    }
    worker?.terminate();
    worker = null;
    inFlight.reject(new CompileSupersededError());
    inFlight = null;
  }
  const job = queuedJob;
  queuedJob = null;
  const target = spawnWorker();
  if (!target) {
    try {
      job.resolve(compileScad(job.source, job.options));
    } catch (error) {
      job.reject(error instanceof Error ? error : new Error("Compilation failed"));
    }
    return;
  }
  inFlight = job;
  inFlightSince = Date.now();
  target.postMessage({ id: job.id, source: job.source, options: job.options } satisfies CompileWorkerRequest);
}

function compileOffThread(source: string, options: CompileOptions): Promise<CompileResult> {
  return new Promise((resolve, reject) => {
    queuedJob?.reject(new CompileSupersededError());
    queuedJob = { id: ++requestCounter, source, options, resolve, reject };
    pumpWorker();
  });
}

/**
 * compileScad with caching. Returns the result plus which tier served it, so
 * the UI can label cached results honestly instead of reporting a stale
 * compile time as if it just happened.
 */
export async function compileScadCached(source: string, options: CompileOptions = {}): Promise<CachedCompile> {
  const key = compileCacheKey(source, options);
  const memoryHit = memoryGet(key);
  if (memoryHit) return { result: memoryHit, fromCache: "memory" };
  const persistedHit = await persistentGet(key);
  if (persistedHit) {
    memoryPut(key, persistedHit);
    return { result: persistedHit, fromCache: "persistent" };
  }
  const result = await compileOffThread(source, options);
  memoryPut(key, result);
  // Persist only compiles worth the storage round-trip; never block on it.
  if (result.geometry && result.metrics.compileMs >= PERSIST_MIN_COMPILE_MS) {
    void persistentPut(key, result).catch(() => undefined);
  }
  return { result, fromCache: false };
}
