import { redirect } from "next/navigation";

// The gallery moved to the home page (D16); keep old /explore links working.
interface ExplorePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const params = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) search.set(key, value);
  }
  const encoded = search.toString();
  redirect(encoded ? `/?${encoded}` : "/");
}
