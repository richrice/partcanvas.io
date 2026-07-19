import type { Metadata, Viewport } from "next";
import "./globals.css";

// Absolute base for OpenGraph/Twitter images and canonical URLs. BETTER_AUTH_URL
// is the deployment's public origin; the fallback covers engine-only installs.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.BETTER_AUTH_URL ?? "https://partcanvas.io"),
  title: "partcanvas.io — Parametric 3D modeling, in your browser",
  description: "Script, customize, preview, and export printable parametric models with a native web CAD engine.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10120f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
