"use client";

import { Box } from "lucide-react";
import Link from "next/link";
import { AuthMenu } from "./AuthMenu";

// Shared topbar for non-editor pages (profiles, settings, explore).
export function SiteHeader() {
  return (
    <header className="topbar site-header">
      <div className="brand-block">
        <Link className="brand" href="/" aria-label="partcanvas.io editor">
          <span className="brand-mark"><Box size={18} strokeWidth={2.2} /></span>
          <span>partcanvas<span>.io</span></span>
        </Link>
        <span className="beta-badge">ALPHA</span>
      </div>
      <nav className="top-actions">
        <AuthMenu />
      </nav>
    </header>
  );
}
