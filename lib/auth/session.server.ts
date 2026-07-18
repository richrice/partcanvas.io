import { getAuth } from "./auth.server";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  username: string | null;
  bio: string | null;
}

// Route tests stub authentication here instead of minting signed cookies.
// `undefined` means no override; `null` simulates a signed-out request.
let testOverride: SessionUser | null | undefined;
export function setSessionUserForTests(user: SessionUser | null | undefined) {
  testOverride = user;
}

// The single seam every authenticated route uses to resolve the caller.
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  if (testOverride !== undefined) return testOverride;
  return resolveSession(request.headers);
}

// Same seam for server components, which have no Request object; reads the
// incoming headers from Next's request context.
export async function getPageSessionUser(): Promise<SessionUser | null> {
  if (testOverride !== undefined) return testOverride;
  const { headers } = await import("next/headers");
  return resolveSession(await headers());
}

async function resolveSession(headers: Headers): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers });
  if (!session) return null;
  const { id, name, email, image, username, bio } = session.user;
  return { id, name, email, image, username: username ?? null, bio: bio ?? null };
}
