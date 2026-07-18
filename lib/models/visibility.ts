import type { Visibility } from "./types";

// Visibility rules (D10): private models exist only for their owner; unlisted
// models resolve by direct link but never appear in listings; public appears
// everywhere. Listing exclusion is enforced by the queries in
// models.server.ts — this check covers direct access.
export function canViewModel(model: { visibility: Visibility; ownerId: string }, viewerId: string | null | undefined): boolean {
  if (model.visibility === "private") return model.ownerId === viewerId;
  return true;
}
