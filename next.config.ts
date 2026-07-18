import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "www.partcanvas.io" }],
      destination: "https://partcanvas.io/:path*",
      permanent: true,
    }];
  },
  async headers() {
    // D5: permissive CORS ONLY on the public compute/read API. Cookie-
    // authenticated endpoints (/api/auth/*, /api/app/*) must never be listed
    // here — wildcard CORS and session cookies do not mix.
    const cors = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "content-type" },
    ];
    return [
      { source: "/api/render", headers: cors },
      { source: "/api/parameters", headers: cors },
      { source: "/api/models/:path*", headers: cors },
      { source: "/api/health", headers: cors },
      { source: "/api/capabilities", headers: cors },
    ];
  },
};

export default nextConfig;
