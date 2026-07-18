import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Browser-side auth client. The additional-field declarations mirror
// lib/auth/auth.server.ts so session user objects are typed with username/bio.
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        username: { type: "string", required: false },
        bio: { type: "string", required: false },
      },
    }),
  ],
});

export type SessionUser = typeof authClient.$Infer.Session.user;
