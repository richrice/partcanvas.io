"use client";

import { Box, Plus } from "lucide-react";
import Link from "next/link";
import { AuthMenu } from "./AuthMenu";

// Shared topbar for non-editor pages (gallery home, profiles, settings).
export function SiteHeader() {
  return (
    <header className="topbar site-header">
      <div className="brand-block">
        <Link className="brand" href="/" aria-label="partcanvas.io home">
          <span className="brand-mark"><Box size={18} strokeWidth={2.2} /></span>
          <span>partcanvas<span>.io</span></span>
        </Link>
        <span className="beta-badge">ALPHA</span>
      </div>
      <nav className="top-actions">
        <Link className="ghost-button" href="/new"><Plus size={15} /> New model</Link>
        <AuthMenu />
      </nav>
    </header>
  );
}
