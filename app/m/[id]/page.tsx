import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { readHostedModel } from "@/lib/models/store.server";

interface ModelPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ModelPageProps): Promise<Metadata> {
  const model = await readHostedModel((await params).id);
  return model
    ? { title: `${model.name} — partcanvas.io`, description: model.description || `Customize and print ${model.name}.` }
    : { title: "Model not found — partcanvas.io" };
}

export default async function ModelPage({ params }: ModelPageProps) {
  const model = await readHostedModel((await params).id);
  if (!model) notFound();
  return <Workspace initialModel={{ name: model.name, source: model.source, files: model.files, parameters: model.parameters, hostedId: model.id }} />;
}
