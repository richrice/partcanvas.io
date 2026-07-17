import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
