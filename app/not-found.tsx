import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

// Branded 404 for unknown models, profiles, and routes — the default Next
// page is a dead end with no way back into the site.
export default function NotFound() {
  return (
    <div className="page-shell">
      <SiteHeader />
      <main className="page-main not-found-main">
        <p className="not-found-code">404</p>
        <h1>This page doesn&apos;t exist</h1>
        <p className="not-found-hint">
          The model may have been deleted or made private, or the link has a typo.
        </p>
        <p className="not-found-links">
          <Link className="primary-button" href="/">Browse the gallery</Link>
          <Link className="ghost-button" href="/new">Open the editor</Link>
        </p>
      </main>
    </div>
  );
}
