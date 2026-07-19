import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { hasDatabase } from "@/lib/db/client.server";
import { findModelForRevision } from "@/lib/models/models.server";
import { readRevision } from "@/lib/models/revisions.server";

async function resolveHostedModel(id: string) {
  return hasDatabase() ? readRevision(id) : null;
}

interface ModelPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ModelPageProps): Promise<Metadata> {
  const model = await resolveHostedModel((await params).id);
  if (!model) return { title: "Model not found — partcanvas.io" };
  const title = `${model.name} — partcanvas.io`;
  const description = model.description || `Customize and print ${model.name}.`;
  const thumbnail = `/api/models/${model.id}/thumbnail`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [thumbnail] },
    twitter: { card: "summary_large_image", title, description, images: [thumbnail] },
  };
}

export default async function ModelPage({ params }: ModelPageProps) {
  const model = await resolveHostedModel((await params).id);
  if (!model) notFound();
  const communityModel = hasDatabase() ? await findModelForRevision(model.id) : null;
  return (
    <Workspace
      key={model.id}
      initialModel={{ name: model.name, source: model.source, files: model.files, parameters: model.parameters, hostedId: model.id }}
      revisionOf={communityModel && communityModel.ownerUsername ? {
        title: communityModel.title,
        author: communityModel.ownerUsername,
        url: `/u/${communityModel.ownerUsername}/${communityModel.slug}`,
        version: communityModel.version ?? undefined,
      } : undefined}
    />
  );
}
