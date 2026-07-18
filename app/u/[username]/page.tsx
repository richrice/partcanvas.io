import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModelCard } from "@/components/ModelCard";
import { SiteHeader } from "@/components/SiteHeader";
import { getPageSessionUser } from "@/lib/auth/session.server";
import { listModelsByOwner } from "@/lib/models/models.server";

interface ProfilePageProps {
  params: Promise<{ username: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { username } = await params;
  return { title: `${username} — partcanvas.io` };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params;
  const viewer = await getPageSessionUser();
  const listing = await listModelsByOwner(username, { viewerId: viewer?.id });
  if (!listing) notFound();
  const isOwner = viewer?.id === listing.owner.id;
  return (
    <div className="page-shell">
      <SiteHeader />
      <main className="page-main">
        <section className="profile-head">
          <h1>{listing.owner.username}</h1>
          <p>{listing.owner.name}{isOwner ? <> · <a href="/settings">Edit profile</a></> : null}</p>
          {listing.owner.bio ? <p className="profile-bio">{listing.owner.bio}</p> : null}
        </section>
        {listing.models.length === 0 ? (
          <p className="page-empty">No published models yet.</p>
        ) : (
          <section className="model-grid">
            {listing.models.map((model) => (
              <ModelCard
                key={model.id}
                href={`/u/${listing.owner.username}/${model.slug}`}
                title={model.title}
                likeCount={model.likeCount}
                downloadCount={model.downloadCount}
                thumbnailUrl={`/api/models/${model.headRevisionId}/thumbnail`}
                visibility={model.visibility}
              />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
