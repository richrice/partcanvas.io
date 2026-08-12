import { build } from "esbuild";

// Node's worker_threads needs a real JavaScript file on disk, and Next's
// server bundler does not emit one. So the render worker is bundled here into
// worker-build/render-worker.js, which the Dockerfile copies into the image
// and lib/render-pool.server.ts resolves relative to the working directory.
// Run after `next build` (which clears .next) and before `next dev`; the
// vitest global setup runs it too.

await build({
  entryPoints: ["lib/render-worker.server.ts"],
  outfile: "worker-build/render-worker.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
});
