import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ModelCard } from "@/components/ModelCard";
import { SiteHeader } from "@/components/SiteHeader";
import { hasDatabase } from "@/lib/db/client.server";
import { exploreModels, type ExploreSort } from "@/lib/models/models.server";

// The community gallery IS the home page (D16, ShaderToy-style): browsing
// comes first, the editor lives at /new.

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "partcanvas.io — Parametric 3D models, made and shared in the browser",
  description: "Browse, customize, and export printable parametric 3D models published by the partcanvas.io community — or script your own with a native web CAD engine.",
};

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function galleryHref(params: { q?: string; tag?: string; sort?: string; page?: number }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.tag) search.set("tag", params.tag);
  if (params.sort && params.sort !== "newest") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const encoded = search.toString();
  return encoded ? `/?${encoded}` : "/";
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  // Legacy anonymous share links pointed the editor at /?model=… — keep every
  // one of them working by forwarding to the editor's new address.
  const sharedModel = single(params.model);
  if (sharedModel) redirect(`/new?model=${encodeURIComponent(sharedModel)}`);

  const q = single(params.q).trim();
  const tag = single(params.tag).trim().toLowerCase();
  const sort: ExploreSort = single(params.sort) === "liked" ? "liked" : "newest";
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);
  const results = hasDatabase()
    ? await exploreModels({ query: q || undefined, tag: tag || undefined, sort, page })
    : { models: [], page: 1, hasMore: false };

  return (
    <div className="page-shell">
      <SiteHeader />
      <main className="page-main">
        <section className="explore-head">
          <h1>Discover parametric models</h1>
          <p className="home-tagline">
            Script-first printable 3D models. Browse the community library, tweak any model&apos;s
            parameters right in the browser, and export STL, STEP, 3MF, and more — or start from
            a blank canvas.
          </p>
          <div className="home-actions">
            <form className="explore-search" action="/" method="get">
              <Search size={15} />
              <input aria-label="Search models" type="search" name="q" defaultValue={q} placeholder="Search titles, descriptions, and tags" />
              {tag ? <input type="hidden" name="tag" value={tag} /> : null}
              {sort !== "newest" ? <input type="hidden" name="sort" value={sort} /> : null}
            </form>
            <Link className="primary-button home-new-button" href="/new"><Plus size={16} /> New model</Link>
          </div>
          <nav className="explore-sorts" aria-label="Sort order">
            <Link className={sort === "newest" ? "active" : ""} href={galleryHref({ q, tag })}>Newest</Link>
            <Link className={sort === "liked" ? "active" : ""} href={galleryHref({ q, tag, sort: "liked" })}>Most liked</Link>
            {tag ? <Link className="explore-tag-filter" href={galleryHref({ q, sort })} title="Clear tag filter">#{tag} ✕</Link> : null}
          </nav>
        </section>
        {results.models.length === 0 ? (
          <p className="page-empty">
            {q || tag
              ? <>No models found{q ? <> for &ldquo;{q}&rdquo;</> : null}{tag ? <> tagged #{tag}</> : null}. <Link href="/">Browse all models</Link></>
              : <>No published models yet — <Link href="/new">be the first</Link>.</>}
          </p>
        ) : (
          <section className="model-grid">
            {results.models.map((model) => (
              <ModelCard
                key={model.id}
                href={`/u/${model.ownerUsername}/${model.slug}`}
                title={model.title}
                author={model.ownerUsername ?? undefined}
                likeCount={model.likeCount}
                downloadCount={model.downloadCount}
                commentCount={model.commentCount}
                viewCount={model.viewCount}
                createdAt={model.createdAt.toISOString()}
                thumbnailUrl={`/api/models/${model.headRevisionId}/thumbnail?v=${model.thumbnailVersion ?? 0}`}
                visibility={model.visibility}
              />
            ))}
          </section>
        )}
        {(page > 1 || results.hasMore) && (
          <nav className="explore-pagination" aria-label="Pagination">
            {page > 1 ? <Link className="ghost-button" href={galleryHref({ q, tag, sort, page: page - 1 })}>← Previous</Link> : <span />}
            <span className="explore-page-indicator">Page {page}</span>
            {results.hasMore ? <Link className="ghost-button" href={galleryHref({ q, tag, sort, page: page + 1 })}>Next →</Link> : <span />}
          </nav>
        )}
      </main>
    </div>
  );
}
