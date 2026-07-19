import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.BETTER_AUTH_URL ?? "https://partcanvas.io";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/settings", "/welcome"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
