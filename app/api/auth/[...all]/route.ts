import { getAuth } from "@/lib/auth/auth.server";

// Cookie-authenticated endpoints: deliberately NO corsPreflight export and no
// permissive CORS headers (D5).
export const runtime = "nodejs";

export async function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  return getAuth().handler(request);
}
