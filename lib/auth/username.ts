// Username rules (§4). Isomorphic — used by the /welcome form for live
// validation and by the claim endpoint for enforcement.

export const USERNAME_PATTERN = /^[a-z0-9-]{3,30}$/;

export const RESERVED_USERNAMES = new Set([
  "about", "abuse", "account", "accounts", "admin", "api", "app", "assets",
  "auth", "blog", "capabilities", "create", "docs", "download", "downloads",
  "edit", "embed", "explore", "health", "help", "home", "legal", "login",
  "logout", "m", "mail", "me", "model", "models", "moderator", "new", "news",
  "official", "parameters", "partcanvas", "privacy", "profile", "profiles",
  "render", "root", "security", "settings", "share", "shop", "sign-in",
  "sign-out", "signin", "signout", "staff", "static", "status", "store",
  "support", "team", "terms", "u", "user", "users", "welcome", "www", "you",
]);

// Returns a human-readable problem, or null when the username is acceptable.
export function validateUsername(username: string): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    return "Usernames are 3–30 characters using lowercase letters, digits, and hyphens";
  }
  if (RESERVED_USERNAMES.has(username)) return "That username is reserved";
  return null;
}
