import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { getPageSessionUser } from "@/lib/auth/session.server";
import { hasLiked } from "@/lib/models/likes.server";
import { getForkLineage, getModelByOwnerSlug, listModelVersions, recordView } from "@/lib/models/models.server";
import { readRevision, readRevisionThumbnailState } from "@/lib/models/revisions.server";
import { THUMBNAIL_VERSION } from "@/lib/models/thumbnails.server";
import { canViewModel } from "@/lib/models/visibility";

interface ModelPageProps {
  params: Promise<{ username: string; slug: string }>;
}

export const dynamic = "force-dynamic";

async function loadVisibleModel(username: string, slug: string) {
  const found = await getModelByOwnerSlug(username, slug);
  if (!found) return null;
  const viewer = await getPageSessionUser();
  if (!canViewModel(found.model, viewer?.id)) return null;
  return { ...found, viewer };
}

export async function generateMetadata({ params }: ModelPageProps): Promise<Metadata> {
  const { username, slug } = await params;
  const found = await loadVisibleModel(username, slug);
  if (!found) return { title: "Model not found — partcanvas.io" };
  const title = `${found.model.title} by ${found.owner.username} — partcanvas.io`;
  const description = found.model.description || `Customize and print ${found.model.title}.`;
  const thumbnailState = await readRevisionThumbnailState(found.model.headRevisionId);
  const thumbnail = `/api/models/${found.model.headRevisionId}/thumbnail?v=${thumbnailState?.version ?? 0}`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [thumbnail] },
    twitter: { card: "summary_large_image", title, description, images: [thumbnail] },
  };
}

export default async function ModelPage({ params }: ModelPageProps) {
  const { username, slug } = await params;
  const found = await loadVisibleModel(username, slug);
  if (!found) notFound();
  const revision = await readRevision(found.model.headRevisionId);
  if (!revision) notFound();
  const thumbnailState = await readRevisionThumbnailState(found.model.headRevisionId);
  const thumbnailStale = !thumbnailState?.present || (thumbnailState.version ?? 0) < THUMBNAIL_VERSION;
  const viewerLiked = found.viewer ? await hasLiked(found.model.id, found.viewer.id) : false;
  const lineage = await getForkLineage(found.model);
  const versions = await listModelVersions(found.model.id);
  // Owners browsing their own page don't count; failures must never block render.
  if (found.viewer?.id !== found.model.ownerId) void recordView(found.model.id).catch(() => {});
  const forkLink = (fork: { title: string; slug: string; ownerUsername: string | null }) => ({
    title: fork.title,
    author: fork.ownerUsername ?? "",
    url: `/u/${fork.ownerUsername}/${fork.slug}`,
  });
  return (
    <Workspace
      // Remount on cross-model client navigation (e.g. fork → the new fork's
      // page) so per-model state doesn't leak between models.
      key={found.model.id}
      initialModel={{
        name: found.model.title,
        source: revision.source,
        files: revision.files,
        parameters: revision.parameters,
        hostedId: revision.id,
      }}
      social={{
        modelId: found.model.id,
        title: found.model.title,
        description: found.model.description,
        license: found.model.license,
        authorUsername: found.owner.username ?? "",
        authorName: found.owner.name,
        likeCount: found.model.likeCount,
        downloadCount: found.model.downloadCount,
        commentCount: found.model.commentCount,
        viewCount: found.model.viewCount + (found.viewer?.id !== found.model.ownerId ? 1 : 0),
        visibility: found.model.visibility,
        createdAt: found.model.createdAt.toISOString(),
        updatedAt: found.model.updatedAt.toISOString(),
        tags: found.model.tags,
        viewerLiked,
        forkedFrom: lineage.forkedFrom ? forkLink(lineage.forkedFrom) : undefined,
        forkCount: lineage.forkCount,
        forks: lineage.forks.map(forkLink),
        viewerIsOwner: found.viewer?.id === found.model.ownerId,
        thumbnailStale,
        versions: versions.map((entry) => ({ version: entry.version, revisionId: entry.revisionId, publishedAt: entry.publishedAt.toISOString() })),
      }}
    />
  );
}
