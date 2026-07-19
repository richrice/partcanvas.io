import { compileScad, type CompileOptions, type CompileResult } from "@/lib/scad/compiler";

// Web Worker entry: runs compileScad off the main thread so heavy CSG never
// freezes the editor UI. The engine is isomorphic (no Node built-ins, no DOM),
// which is what lets it load in a worker unchanged. Spawned lazily by
// lib/compile-cache.ts via `new Worker(new URL("./compile-worker.ts", ...))`.

export interface CompileWorkerRequest {
  id: number;
  source: string;
  options: CompileOptions;
}

export type CompileWorkerResponse =
  | { id: number; ok: true; result: CompileResult }
  | { id: number; ok: false; error: string };

// In a module worker, globalThis is the worker scope; typing it structurally
// avoids depending on the WebWorker TS lib alongside DOM.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CompileWorkerRequest>) => void) | null;
  postMessage(message: CompileWorkerResponse): void;
};

scope.onmessage = (event) => {
  const { id, source, options } = event.data;
  try {
    scope.postMessage({ id, ok: true, result: compileScad(source, options) });
  } catch (error) {
    scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Compilation failed" });
  }
};
