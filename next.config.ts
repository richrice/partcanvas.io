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
    return [{
      source: "/api/:path*",
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
        { key: "Access-Control-Allow-Headers", value: "content-type" },
      ],
    }];
  },
};

export default nextConfig;
