import type { Metadata } from "next";
import { Search } from "lucide-react";
import Link from "next/link";
import { ModelCard } from "@/components/ModelCard";
import { SiteHeader } from "@/components/SiteHeader";
import { exploreModels, type ExploreSort } from "@/lib/models/models.server";

interface ExplorePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore models — partcanvas.io",
  description: "Browse, search, and customize parametric 3D models published by the partcanvas.io community.",
};

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function exploreHref(params: { q?: string; tag?: string; sort?: string; page?: number }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.tag) search.set("tag", params.tag);
  if (params.sort && params.sort !== "newest") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const encoded = search.toString();
  return encoded ? `/explore?${encoded}` : "/explore";
}

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const params = await searchParams;
  const q = single(params.q).trim();
  const tag = single(params.tag).trim().toLowerCase();
  const sort: ExploreSort = single(params.sort) === "liked" ? "liked" : "newest";
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);
  const results = await exploreModels({ query: q || undefined, tag: tag || undefined, sort, page });

  return (
    <div className="page-shell">
      <SiteHeader />
      <main className="page-main">
        <section className="explore-head">
          <h1>Explore models</h1>
          <form className="explore-search" action="/explore" method="get">
            <Search size={15} />
            <input aria-label="Search models" type="search" name="q" defaultValue={q} placeholder="Search titles, descriptions, and tags" />
            {tag ? <input type="hidden" name="tag" value={tag} /> : null}
            {sort !== "newest" ? <input type="hidden" name="sort" value={sort} /> : null}
          </form>
          <nav className="explore-sorts" aria-label="Sort order">
            <Link className={sort === "newest" ? "active" : ""} href={exploreHref({ q, tag })}>Newest</Link>
            <Link className={sort === "liked" ? "active" : ""} href={exploreHref({ q, tag, sort: "liked" })}>Most liked</Link>
            {tag ? <Link className="explore-tag-filter" href={exploreHref({ q, sort })} title="Clear tag filter">#{tag} ✕</Link> : null}
          </nav>
        </section>
        {results.models.length === 0 ? (
          <p className="page-empty">No models found{q ? ` for “${q}”` : ""}{tag ? ` tagged #${tag}` : ""}.</p>
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
                thumbnailUrl={`/api/models/${model.headRevisionId}/thumbnail`}
                visibility={model.visibility}
              />
            ))}
          </section>
        )}
        <nav className="explore-pagination" aria-label="Pagination">
          {page > 1 ? <Link className="ghost-button" href={exploreHref({ q, tag, sort, page: page - 1 })}>← Previous</Link> : <span />}
          {results.hasMore ? <Link className="ghost-button" href={exploreHref({ q, tag, sort, page: page + 1 })}>Next →</Link> : <span />}
        </nav>
      </main>
    </div>
  );
}
