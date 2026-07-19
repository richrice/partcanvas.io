import type { MetadataRoute } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb, hasDatabase } from "@/lib/db/client.server";
import { models, user } from "@/lib/db/schema";

// Public models and profiles for search engines. Capped generously; the
// engine-only deployment (no DATABASE_URL) still serves the static pages.
const SITEMAP_LIMIT = 5_000;

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.BETTER_AUTH_URL ?? "https://partcanvas.io";
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/new`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/docs/api`, changeFrequency: "monthly", priority: 0.5 },
  ];
  if (!hasDatabase()) return staticEntries;
  const rows = await getDb().select({
    slug: models.slug,
    updatedAt: models.updatedAt,
    ownerUsername: user.username,
  }).from(models)
    .innerJoin(user, eq(models.ownerId, user.id))
    .where(eq(models.visibility, "public"))
    .orderBy(desc(models.updatedAt))
    .limit(SITEMAP_LIMIT);
  const usernames = [...new Set(rows.map((row) => row.ownerUsername).filter((name): name is string => name !== null))];
  return [
    ...staticEntries,
    ...usernames.map((username) => ({ url: `${base}/u/${username}`, changeFrequency: "daily" as const, priority: 0.6 })),
    ...rows.filter((row) => row.ownerUsername).map((row) => ({
      url: `${base}/u/${row.ownerUsername}/${row.slug}`,
      lastModified: row.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
