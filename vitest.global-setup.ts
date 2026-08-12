import { execFileSync } from "node:child_process";

// /api/render spawns a worker from worker-build/render-worker.js, which is a
// build artifact rather than a source file. Build it before any test runs, so
// a single-file run works the same as `npm test`.
export default function setup() {
  execFileSync(process.execPath, ["scripts/build-render-worker.mjs"], { stdio: "inherit" });
}
