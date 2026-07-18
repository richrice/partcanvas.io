import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb, type Database } from "../db/client.server";
import * as schema from "../db/schema";

// Better Auth (D4): GitHub + Google social sign-in only, sessions in Postgres.
// Secret/base URL come from BETTER_AUTH_SECRET / BETTER_AUTH_URL env vars,
// which betterAuth reads itself. Construction is lazy so importing a route
// module never touches the database (next build runs without DATABASE_URL).
export function createAuth(db: Database) {
  return betterAuth({
    appName: "partcanvas.io",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID ?? "",
        clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },
    user: {
      additionalFields: {
        // Server-controlled (input: false): set exactly once via /welcome with
        // reserved-name and format validation, never from raw client input.
        username: { type: "string", required: false, input: false },
        bio: { type: "string", required: false },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | null = null;

export function getAuth(): Auth {
  return (cached ??= createAuth(getDb()));
}
