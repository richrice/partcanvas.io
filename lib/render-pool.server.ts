import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { RenderWorkerRequest, RenderWorkerResponse } from "./render-worker.server";

// A pool of Node workers for /api/render. compileScad is synchronous CPU work
// with no upper bound — a knurled container needs about two minutes — so
// running it on the request thread froze the whole instance, health check
// included, and outlived the proxy timeout.
//
// Workers stay warm between requests because loading the engine costs more
// than a small render. A job that outlives the budget has its worker
// terminated, which is the only way to stop synchronous CSG.

const WORKER_FILE = path.join(process.cwd(), "worker-build", "render-worker.js");
const MAX_WORKERS = Math.max(1, availableParallelism() - 1);
const QUEUE_LIMIT = MAX_WORKERS * 4;
export const RENDER_BUDGET_MS = 25_000;

export class RenderBusyError extends Error {
  constructor() {
    super("The render queue is full. Retry shortly.");
    this.name = "RenderBusyError";
  }
}

export class RenderBudgetError extends Error {
  constructor() {
    super(`The model did not finish within the ${RENDER_BUDGET_MS / 1000} second render budget. Simplify it, lower $fn, or render it locally.`);
    this.name = "RenderBudgetError";
  }
}

interface Waiter {
  resolve: (worker: Worker) => void;
  reject: (error: Error) => void;
}

let idle: Worker[] = [];
let busy = 0;
const waiting: Waiter[] = [];

function spawn(): Worker {
  if (!existsSync(WORKER_FILE)) {
    throw new Error(`Render worker bundle missing at ${WORKER_FILE}. Run 'node scripts/build-render-worker.mjs'.`);
  }
  const worker = new Worker(WORKER_FILE);
  // A worker that dies while parked must not be handed to the next job.
  worker.once("exit", () => {
    const index = idle.indexOf(worker);
    if (index >= 0) idle.splice(index, 1);
  });
  return worker;
}

async function acquire(): Promise<Worker> {
  const free = idle.pop();
  if (free) {
    busy++;
    return free;
  }
  if (busy < MAX_WORKERS) {
    const worker = spawn();
    busy++;
    return worker;
  }
  if (waiting.length >= QUEUE_LIMIT) throw new RenderBusyError();
  return new Promise<Worker>((resolve, reject) => waiting.push({ resolve, reject }));
}

// Pass the slot to the next waiter, or park the worker. `worker` is null when
// the job killed it, so the slot survives even though the thread did not.
function release(worker: Worker | null): void {
  const next = waiting.shift();
  if (next) {
    try {
      next.resolve(worker ?? spawn());
    } catch (error) {
      busy--;
      next.reject(error as Error);
    }
    return;
  }
  busy--;
  if (worker) idle.push(worker);
}

export async function runRender(request: RenderWorkerRequest): Promise<RenderWorkerResponse> {
  const worker = await acquire();
  return new Promise<RenderWorkerResponse>((resolve, reject) => {
    let settled = false;
    const settle = (reuse: boolean, complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
      release(reuse ? worker : null);
      complete();
    };
    const onMessage = (response: RenderWorkerResponse) => settle(true, () => resolve(response));
    const onError = (error: Error) => settle(false, () => reject(error));
    const onExit = () => settle(false, () => reject(new Error("The render worker stopped unexpectedly")));

    // settle() reads `timer` only from a listener, all attached below.
    const timer = setTimeout(() => {
      void worker.terminate();
      settle(false, () => reject(new RenderBudgetError()));
    }, RENDER_BUDGET_MS);
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
    worker.postMessage(request);
  });
}

// Tests call this so parked workers do not hold the process open.
export async function shutdownRenderPool(): Promise<void> {
  const parked = idle;
  idle = [];
  await Promise.all(parked.map((worker) => worker.terminate()));
}
