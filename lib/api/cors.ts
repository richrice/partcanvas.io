export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-expose-headers": "content-disposition, x-partcanvas-triangles, x-partcanvas-compile-ms, x-partcanvas-volume-mm3, x-partcanvas-area-mm2, x-partcanvas-dimension, x-partcanvas-warning-count, x-partcanvas-warnings, x-partcanvas-parameter-set",
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
