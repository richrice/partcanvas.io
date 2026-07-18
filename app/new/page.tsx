import type { Metadata } from "next";
import { Workspace } from "@/components/Workspace";

// The editor (D16): reached from the gallery's "New model", from forks, and
// by legacy /?model=… share links which redirect here with the payload.
export const metadata: Metadata = {
  title: "New model — partcanvas.io",
  description: "Script, customize, preview, and export printable parametric models with a native web CAD engine.",
};

export default function NewModelPage() {
  return <Workspace />;
}
