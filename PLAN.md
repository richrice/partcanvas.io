# Community Platform Plan — accounts, likes, forking, model pages

**This is a living design + progress document.** It is the source of truth for adding user-repository features to partcanvas.io (a cross between ShaderToy and Printables: script-first parametric models with profiles, likes, forks, and browsing). It is written to be executed incrementally by Claude Code sessions with no other context beyond this file and CLAUDE.md.

## Working agreements (read first, every session)

1. Work on the `community-platform` branch (create from `main` if it doesn't exist).
2. Pick the **first unchecked task** in the earliest incomplete phase. Tasks marked **[HUMAN]** need the repo owner (credentials, production actions) — skip them, continue with anything not blocked by them, and flag them in the Progress log.
3. Do not start a task whose listed dependencies are unchecked, and do not re-litigate entries in the Decision log. If implementation reveals a decision is wrong, append a superseding entry to the Decision log with rationale — never silently diverge.
4. A task is done when: implementation matches its **Done when** criteria, new/changed behavior has tests, and `npm test`, `npm run lint`, and `npx tsc --noEmit` all pass.
5. On completion: check the box, append a Progress log entry (date, task ID, one-line summary, deviations), update README.md / CLAUDE.md if the task changed a contract they document, and commit with the task ID in the message (e.g. `P1.2: serve /m/:id from Postgres revisions`).
6. Preserve the existing hard rules of this codebase: everything under `lib/scad/`, `lib/share.ts`, and `lib/project-assets.ts` stays free of Node built-ins (the engine runs in the browser); server-only modules use the `.server.ts` suffix; tests are colocated `*.test.ts`.

## 1. Product vision

Two personas already exist (authors script models; makers customize and download). This plan adds the community layer:

- **Accounts** via GitHub/Google OAuth — no passwords.
- **Hosted models with owners**: publishing requires an account. The existing gzip share-links remain the anonymous, no-account tier.
- **Likes** (single positive vote per user per model) and download counts.
- **Forking** with visible lineage (ShaderToy-style attribution) and **versioned updates** (Printables-style history).
- **Browsing**: profiles, an explore page with search/tags/sort, thumbnail grid.

## 2. Architecture: revisions vs. models

Today `lib/models/store.server.ts` stores immutable, content-addressed records (sha256 → 24-hex ID, dedup via atomic hard links) on the filesystem, served at `/m/:id`. That primitive is kept, not replaced — it becomes the **revision** object in a git-like model:

- **Revision** — immutable content object, exactly today's `HostedModel` payload (source, files, parameters, schema, metrics). Same 24-hex content-hash ID. Revisions are global and shared: they belong to no single model. `/m/:id` remains a permanent revision permalink; every existing link keeps resolving.
- **Model** — new mutable social object: owner, slug, title, description, license, visibility, head-revision pointer, fork lineage, denormalized counts. Lives at `/u/:username/:slug`.
- **Publishing an update** = insert new revision (dedup is automatic) + append to the model's history + move the head pointer.
- **Forking** = new model row pointing at the *same* revision, `forked_from_*` set. Zero bytes copied.

## 3. Decision log

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Postgres (Railway-hosted) replaces the filesystem store; **Drizzle ORM** + drizzle-kit migrations; `pg` driver in prod | Relational/social queries; removes the one-replica-per-volume scaling ceiling; Drizzle is light and fully typed |
| D2 | Revision payloads stored as **JSONB in Postgres** (2 MB cap already enforced), not object storage | One storage system; payloads are small text; keeps deploys simple |
| D3 | Tests use **PGlite** (`@electric-sql/pglite`) with real migrations applied — no Docker or network needed in vitest | Keeps the test suite autonomous and fast for unattended loop sessions |
| D4 | Auth: **Better Auth** with Drizzle adapter, GitHub + Google social providers only, sessions in Postgres | Self-hosted (fits Railway/Docker posture, no per-MAU bill); audience has GitHub accounts |
| D5 | **CORS split**: `Access-Control-Allow-Origin: *` stays ONLY on public compute/read endpoints (`/api/render`, `/api/parameters`, `GET /api/models/*`, `/api/health`, `/api/capabilities`). Cookie-authenticated mutations live under `/api/app/*` and `/api/auth/*` with NO permissive CORS | The open API is a feature; cookies + wildcard CORS must never mix |
| D6 | Anonymous `POST /api/models` is retired in Phase 2 (401). Programmatic publishing returns in Phase 5 via **bearer API tokens** (token auth is CORS-safe) | Ownership and abuse accountability require identity |
| D7 | Revision IDs stay 24-hex content hashes; model IDs are server-generated opaque strings; models are addressed publicly by `owner username + slug` (slug immutable in v1) | Preserves all existing URLs and dedup semantics |
| D8 | Thumbnails: captured **client-side** from the three.js canvas at publish time (PNG, ≤ 512 KB), stored as `bytea` on the revision row, served via `GET /api/models/:id/thumbnail` | Headless server WebGL is a tarpit; don't block on it. Server re-render is future work |
| D9 | Voting = single "like" per user per model (Printables-style), denormalized `like_count` maintained transactionally | Simplest social signal; up/down adds moderation burden for no gain here |
| D10 | Every model has a **license** (choices: CC-BY-4.0 default, CC-BY-SA-4.0, CC-BY-NC-4.0, CC0-1.0, All rights reserved) and **visibility** (`public` / `unlisted` / `private`) from the first schema migration | Painful to retrofit; unlisted doubles as the moderation pressure valve |
| D11 | Search = Postgres full-text (generated `tsvector` over title/description/tags + GIN index); sorts = newest and most-liked. No external search service | Right-sized for launch |
| D12 | Rate limiting = in-memory token buckets (per-IP for anonymous compute, per-user for social mutations). Known single-instance limitation, documented | The app currently runs one replica; revisit only if that changes |
| D13 | Migrations run at boot via `instrumentation.ts` (`migrate()` from drizzle-orm before serving) | Single replica makes boot-time migration safe and removes a deploy step |
| D14 | During transition, `/m/:id` reads Postgres first and falls back to the legacy filesystem store; the filesystem path is deleted in Phase 5 after production data is imported | Zero-downtime migration without a flag day |

## 4. Data model

Better Auth owns `user` / `session` / `account` / `verification` tables (user extended with `username` — unique, lowercase, `^[a-z0-9-]{3,30}$`, reserved list (`admin`, `api`, `m`, `u`, `explore`, `settings`, `docs`, ...) — and `bio`).

Application tables (Drizzle schema in `lib/db/schema.ts`):

- **revisions** — `id char(24) PK` (content hash), `record jsonb` (HostedModel v1 payload), `thumbnail bytea NULL`, `created_at`. Pure content store; no owner, no model FK.
- **models** — `id text PK`, `owner_id FK→user`, `slug`, `title`, `description`, `license`, `visibility`, `tags text[]`, `head_revision_id FK→revisions`, `forked_from_model_id FK NULL`, `forked_from_revision_id FK NULL`, `like_count int`, `download_count int`, `created_at`, `updated_at`, generated `search tsvector` + GIN index. Unique `(owner_id, slug)`.
- **model_revisions** — `model_id FK`, `revision_id FK`, `version int`, `published_at`; PK `(model_id, version)`. Ordered history; head is denormalized on `models`.
- **likes** — `user_id FK`, `model_id FK`, `created_at`; PK `(user_id, model_id)`.
- **api_tokens** (Phase 5) — `id`, `user_id FK`, `token_hash`, `prefix`, `created_at`, `last_used_at`.
- **reports** (Phase 5) — `id`, `model_id FK`, `reporter_id FK NULL`, `reason`, `created_at`, `resolved_at NULL`.

## 5. URL & API map

Pages: `/` editor (unchanged) · `/m/:id` revision permalink → Workspace (unchanged semantics) · `/u/:username` profile · `/u/:username/:slug` model page (Workspace + social chrome: author, like, fork, license, description, counts) · `/explore` browse/search · `/welcome` username picker after first login · `/settings` profile + tokens.

API, public with CORS `*`: `POST /api/render`, `POST /api/parameters`, `GET /api/models/:id`, `GET /api/models/:id/thumbnail`, `GET /api/health`, `GET /api/capabilities`, and (Phase 5) `POST /api/models` with bearer token.

API, session-authenticated, no permissive CORS: `/api/auth/[...all]` (Better Auth) · `POST /api/app/models` publish · `POST /api/app/models/:id/like` toggle · `POST /api/app/models/:id/fork` · `POST /api/app/models/:id/download` beacon · `PATCH /api/app/models/:id` metadata · `DELETE /api/app/models/:id`.

## 6. Environment

| Variable | Purpose | Where |
|----------|---------|-------|
| `DATABASE_URL` | Postgres connection | Railway + local `.env` (compose Postgres) |
| `BETTER_AUTH_SECRET` | session signing | Railway + local |
| `BETTER_AUTH_URL` | canonical origin (`https://partcanvas.io`) | Railway + local |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth | Railway + local |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth | Railway + local |
| `PARTCANVAS_DATA_DIR` | legacy filesystem store — removed in Phase 5 | — |

---

## 7. Implementation phases

### Phase 0 — Foundations

- [x] **P0.1** Create `community-platform` branch from `main`. Add deps: `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`, `@electric-sql/pglite` (dev). Add npm scripts: `typecheck` (`tsc --noEmit`), `db:generate` (`drizzle-kit generate`).
  *Done when: install is clean, scripts run, existing tests still pass.*
- [x] **P0.2** DB plumbing: `drizzle.config.ts`; `lib/db/schema.ts` (start with `revisions` only); `lib/db/client.server.ts` (pg Pool from `DATABASE_URL`, drizzle instance); generated SQL migrations committed under `drizzle/`; `instrumentation.ts` running `migrate()` at boot (skip cleanly when `DATABASE_URL` is unset so `next build` works).
  *Done when: dev server boots and migrates against a local Postgres.*
- [x] **P0.3** Test harness: `lib/db/test-db.server.ts` creating a fresh PGlite database with the committed migrations applied; a smoke test inserts and reads back a revision row. Document the pattern in a comment — all later DB tests use this helper.
  *Done when: `npm test` passes with no external services running.*
- [x] **P0.4** Local dev: add `postgres:17-alpine` service + named volume to `compose.yaml`; `DATABASE_URL` in `.env.example`; README "Development" section updated.
  *Done when: `docker compose up` yields a working local stack.*
- [ ] **P0.5 [HUMAN]** Provision Railway Postgres and set `DATABASE_URL` in the Railway environment (the agent may do this via the Railway CLI if authenticated and explicitly approved).

### Phase 1 — Revisions in Postgres

- [x] **P1.1** Revision store `lib/models/revisions.server.ts`: `saveRevision(draft)` reusing the existing validation + canonical-JSON + sha256 logic from `store.server.ts`, insert with `ON CONFLICT DO NOTHING` + read-back (replaces the hard-link trick); `readRevision(id)`. Port/adapt the store's behavior; compile-before-save stays.
  *Done when: unit tests cover dedup, validation errors, and roundtrip against PGlite.*
- [x] **P1.2** Serve from Postgres: `POST /api/models`, `GET /api/models/:id`, and `/m/:id` use the revision store, with filesystem fallback on read (D14). Response contracts unchanged (existing `route.test.ts` files keep passing, updated only for setup).
- [x] **P1.3** Import script `scripts/import-models.ts` (plain TS; Node 24 runs it directly): reads `$PARTCANVAS_DATA_DIR/*.json`, upserts into `revisions`, idempotent, prints a summary. **[HUMAN]** run it against production data (e.g. `railway run node scripts/import-models.ts`).
- [x] **P1.4** `/api/health` checks DB connectivity (replacing the writable-directory probe as the readiness signal; report both during transition). Audit `/api/capabilities` for storage claims.
- [x] **P1.5** Docs sweep: README storage/deployment sections and CLAUDE.md reflect Postgres; note the D14 transition state.

### Phase 2 — Accounts

- [x] **P2.1** Better Auth: config in `lib/auth/auth.server.ts` (Drizzle adapter, GitHub + Google, `username`/`bio` additional fields), generated schema merged into `lib/db/schema.ts` + migration, handler at `app/api/auth/[...all]/route.ts`, client in `lib/auth/client.ts`.
  *Done when: local OAuth round-trip works with dev credentials.*
- [ ] **P2.2 [HUMAN]** Create GitHub and Google OAuth apps (callback `https://partcanvas.io/api/auth/callback/{github,google}` + localhost equivalents); set env vars locally and in Railway.
- [x] **P2.3** Session helper `lib/auth/session.server.ts` exporting `getSessionUser(request)` — the single seam all authenticated routes use, so tests can stub it.
- [x] **P2.4** CORS scope-down (D5): replace the blanket `/api/:path*` header block in `next.config.ts` with the explicit public list; add tests asserting `/api/auth/*` and `/api/app/*` responses carry no `Access-Control-Allow-Origin`.
- [x] **P2.5** Auth UI: sign-in/account menu in the Workspace header; `/welcome` username picker (validation + reserved names per §4, uniqueness race handled); middleware/redirect until username chosen.
- [x] **P2.6** Social schema migration: `models`, `model_revisions`, `likes` tables per §4.
  *Done when: migration applies on PGlite + Postgres; store module `lib/models/models.server.ts` has tested create/read/list helpers.*
- [x] **P2.7** Authenticated publish: `POST /api/app/models` creates model (title, auto-slug with dedup suffix, description, license, visibility, tags) + revision + history row atomically; publish dialog in `Workspace.tsx` gains those fields and, when signed in, targets the new endpoint (share-link flow unchanged for anonymous users); success routes to `/u/:username/:slug`.
- [x] **P2.8** Retire anonymous publish (D6): `POST /api/models` returns 401 with a message pointing at sign-in and the Phase-5 token plan; README + `/docs/api` page updated.

### Phase 3 — Social surface

- [x] **P3.1** Thumbnails: `ModelViewport` exposes a capture method (mind WebGL `preserveDrawingBuffer` — render-then-read in the same frame); publish flow uploads PNG ≤ 512 KB stored on the revision row; `GET /api/models/:id/thumbnail` serves it with long-lived cache headers (immutable content) and a placeholder 404 behavior.
- [x] **P3.2** Model page `app/u/[username]/[slug]/page.tsx`: loads model + head revision server-side, renders Workspace with a social chrome bar (title, author link, description, license badge, like button, fork button placeholder, download + like counts). Visibility enforced (`private` → 404 for non-owners; `unlisted` → no listings, direct link OK).
- [x] **P3.3** Profiles: `/u/[username]` public model grid (thumbnail, title, counts); `/settings` to edit display name + bio.
- [x] **P3.4** Likes: `POST /api/app/models/:id/like` toggles + updates `like_count` in one transaction; optimistic button state; tested for double-like idempotency.
- [x] **P3.5** Explore: `/explore` with newest / most-liked sorts, tag filter, FTS search (D11); public-visibility only; simple pagination.
- [ ] **P3.6** Download beacon: exporting from a hosted model page fires `POST /api/app/models/:id/download` (fire-and-forget, works signed-out too — move under `/api/models/:id/download` if cookie-free is simpler; no dedup in v1).
- [ ] **P3.7** Navigation: header links (Explore, profile), `/m/:id` pages link back to a model page when the revision is some public model's head; README feature overview updated.

### Phase 4 — Fork & versions

- [ ] **P4.1** Fork: `POST /api/app/models/:id/fork` creates a model owned by the caller pointing at the source head revision, `forked_from_*` set, slug deduped; fork button navigates to the new model in the editor.
- [ ] **P4.2** Lineage: model page shows "forked from *title* by *author*" (link) and a fork count; forks list on the model page or profile.
- [ ] **P4.3** Updates: publishing from a model you own offers "Update" (new revision, version++, head moves) vs. "Publish as new"; version history list on the model page linking each version's `/m/:id` permalink.
- [ ] **P4.4** Manage: `PATCH /api/app/models/:id` (title, description, tags, license, visibility) and `DELETE` (removes model + history rows; revisions remain — they're content-addressed and may be shared with forks). Owner-only, tested.

### Phase 5 — Hardening, tokens, cleanup

- [ ] **P5.1** Rate limiting (D12): `lib/api/rate-limit.server.ts` token buckets; per-IP on `/api/render` + `/api/parameters` + anonymous reads that hit compile, per-user on publish/like/fork; 429 with `retry-after`; limits documented in `/docs/api`.
- [ ] **P5.2** API tokens: schema, `/settings` create/revoke UI (hash stored, plaintext shown once), bearer auth restores programmatic `POST /api/models` (publishes as the token's user; requires an explicit target model or creates one from payload metadata); `/docs/api` updated.
- [ ] **P5.3** Moderation basics: report button → `reports` table; verify visibility enforcement everywhere (explore, profiles, thumbnails, `GET /api/models/:id` for private-model head revisions — decide and document whether revision permalinks of private models stay readable; default: yes, IDs are unguessable, note it).
- [ ] **P5.4** Legacy cleanup: delete filesystem store + fallback (D14), drop `PARTCANVAS_DATA_DIR` from Dockerfile/compose/`.env.example`/health; **[HUMAN]** confirm production import (P1.3) first. Final README + CLAUDE.md sweep.

### Backlog (explicitly out of scope for this plan)

Comments, collections, "makes" (print photos), trending/decay ranking, server-side thumbnail re-rendering, email/password auth, object storage, admin dashboard, multi-replica rate limiting.

---

## 8. Progress log

Append entries here; do not rewrite old ones.

| Date | Task | Summary / deviations |
|------|------|----------------------|
| — | — | Plan created; no implementation yet |
| 2026-07-18 | P0.1 | Branch created; drizzle-orm/pg (deps) + drizzle-kit/@types/pg/@electric-sql/pglite (dev) installed; `typecheck` + `db:generate` scripts added. `db:generate` runs but needs drizzle.config.ts (P0.2) to do anything. |
| 2026-07-18 | P0.2 | drizzle.config.ts, lib/db/{schema,client.server,migrate.server}.ts, drizzle/0000_equal_random.sql, instrumentation.ts. Verified: dev boot migrates against Postgres 17 in Docker; `next build` passes with DATABASE_URL unset. |
| 2026-07-18 | P0.3 | lib/db/test-db.server.ts (PGlite + committed migrations, usage documented) + smoke test roundtripping a revision row. No external services needed. |
| 2026-07-18 | P0.4 | compose.yaml: postgres:17-alpine + volume + healthcheck + DATABASE_URL; .env.example + README dev section updated. Deviation: also COPY drizzle/ into Docker runner image (boot migrations read it from disk; standalone tracing misses it). Verified `docker compose up --build`: health ready, migrations applied. |
| 2026-07-18 | P1.1 | lib/models/revisions.server.ts (saveRevision ON CONFLICT DO NOTHING + read-back, readRevision) with validation/hash extracted to shared lib/models/draft.server.ts; store.server.ts refactored onto it unchanged. Stores take optional `db` (driver-agnostic PgDatabase type) so tests inject PGlite. 5 tests: roundtrip, dedup, concurrency, validation, no-solid, bad ids. |
| 2026-07-18 | P1.2 | lib/models/hosted.server.ts transition layer (publish→Postgres when configured, read→Postgres then filesystem; filesystem-only when no DB, keeping DB-less dev working). Routes + /m/:id switched; setDatabaseForTests seam added to client.server.ts. Route tests run on PGlite + new fallback test. E2E-verified against dev server + compose Postgres. |
| 2026-07-18 | P1.3 | Script done (standalone pg + Node built-ins so `node scripts/import-models.ts` runs directly; preserves createdAt; ON CONFLICT idempotent; PGlite-tested + CLI-verified against compose Postgres). **[HUMAN] still pending: run against production data, e.g. `railway run node scripts/import-models.ts` (needs P0.5 DATABASE_URL).** |
| 2026-07-18 | P1.4 | Health reports `database` (inspectDatabase in client.server.ts) + legacy `storage`; readiness = DB reachability when configured, else writable dir. Capabilities `service.persistence` now dynamic; /docs/api health paragraph updated. Tests cover both readiness modes. |
| 2026-07-18 | P1.5 | README production-deployment section rewritten around Postgres + D14 fallback/import; CLAUDE.md commands (typecheck, db:generate, compose postgres) + storage-layer description + deployment/health semantics updated. Phase 1 complete except the P1.3 [HUMAN] production run. |
| 2026-07-18 | P2.1 | better-auth@1.6.23; lib/auth/auth.server.ts (lazy createAuth/getAuth, drizzle adapter, GitHub+Google, username input:false + bio additionalFields), auth tables hand-merged into schema (verified against getAuthTables) + migration 0001, catch-all route (no CORS export), lib/auth/client.ts with inferAdditionalFields. Deviation: full OAuth round-trip untestable until P2.2 [HUMAN] credentials — verified instead via PGlite tests (get-session null; sign-in/social builds GitHub authorize URL and persists state) and env placeholders added to .env.example. |
| 2026-07-18 | P2.3 | lib/auth/session.server.ts: getSessionUser(request) via auth.api.getSession + setSessionUserForTests stub. Tests cover real signed-cookie resolution (HMAC cookie built in-test against PGlite), tampered/absent cookie → null, and both stub modes. P2.2 [HUMAN] skipped (OAuth app credentials). |
| 2026-07-18 | P2.4 | next.config.ts headers now list only /api/render, /api/parameters, /api/models/:path*, /api/health, /api/capabilities. next.config.test.ts asserts scope incl. /api/auth/* + /api/app/* exclusion; auth handler test asserts no ACAO. Live dev-server header check confirmed. |
| 2026-07-18 | P2.5 | AuthMenu (sign-in dropdown / account menu) in Workspace topbar; /welcome picker with live validation; lib/auth/username.ts (isomorphic rules + reserved list); POST /api/app/username claims once (guarded UPDATE + unique index close both races; 401/409/422 paths tested on PGlite). Deviation: username-missing redirect is client-side in AuthMenu (+ /welcome self-guards) rather than Next middleware — middleware would need a DB round-trip per request; revisit if non-Workspace pages need the redirect. |
| 2026-07-18 | P2.6 | models/model_revisions/likes tables per §4 (migration 0002) + lib/models/models.server.ts (createModel atomic w/ v1 history + slug dedup retry, readModel, getModelByOwnerSlug, listModelsByOwner w/ visibility filter). Deviation: search tsvector needs an IMMUTABLE array_to_string wrapper (`immutable_tags_text`, created in the same migration) — Postgres rejects STABLE functions in generated columns. Verified on PGlite (6 tests incl. FTS query + fork lineage) and compose Postgres. |
| 2026-07-18 | P2.7 | POST /api/app/models (session + username required → saveRevision + createModel; model/history atomic; returns /u/:username/:slug). Workspace publish: signed-in users get a metadata dialog (description, license, visibility, tags) targeting the new endpoint and routing to the model URL; anonymous flow unchanged. Route tests: 401/409/201-with-history/422s. Note: /u/:username/:slug page itself lands in P3.2 — publish redirects will 404 until then. |
| 2026-07-18 | P2.8 | POST /api/models → 401 with sign-in + token-plan message (CORS kept — public error). publishHostedModel removed from hosted.server.ts (read-fallback layer remains); Workspace signed-out Publish now prompts sign-in and points at Share. README + /docs/api updated; route tests reworked (seed via saveRevision, GET/etag/304/fallback kept, 401 asserted). Phase 2 complete except P2.2 [HUMAN]. |
| 2026-07-18 | P3.1 | ModelViewport captureRef prop (render-then-read same frame, downscale to ≤512px, byte-cap fallbacks); publish dialog sends thumbnail data URL; decodeThumbnailDataUrl (PNG magic + 512KB cap, invalid = ignored); setRevisionThumbnail immutable-once; GET /api/models/:id/thumbnail serves image/png with max-age=31536000 immutable, 404 placeholder signal. Tests: decode, once-only set, publish→serve roundtrip, invalid-ignored. Browser capture path itself untested (no DOM in vitest) — verify manually with OAuth creds. |
| 2026-07-18 | P3.2 | /u/:username/:slug: server-loads model + head revision, Workspace gains `social` prop rendering chrome bar (title, author link, description, tags, license badge, disabled like/fork placeholders, download count). canViewModel in lib/models/visibility.ts (tested); getPageSessionUser added to the session seam for server components. E2E on dev+Postgres: public 200 w/ chrome, private→404 anonymous, unknown→404. |
| 2026-07-18 | P3.3 | /u/:username profile (SiteHeader + ModelCard grid w/ thumbnail fallback, bio, owner sees own private/unlisted w/ badges + Edit profile link); /settings edits display name + bio via authClient.updateUser. Owner queries now return bio. Test: update-user endpoint round-trip w/ signed cookie (name+bio update, username untouched). E2E: profile 200 public-only for anonymous, ghost 404. |
| 2026-07-18 | P3.4 | lib/models/likes.server.ts toggleLike (insert-or-delete + like_count in one tx, PK forbids double rows) + hasLiked; POST /api/app/models/:id/like (401/404-private/toggle). Social bar like button now live with optimistic state + rollback; model page passes viewerLiked. Tests: idempotent cycle, count consistency, endpoint toggle, auth/visibility. |
| 2026-07-18 | P3.5 | exploreModels store query (public-only, websearch FTS, arrayContains tag filter, newest/liked sorts, fetch-plus-one pagination) + /explore page (search form, sort tabs, tag chip, prev/next). ModelCard gains author line. 4 store tests; E2E: listing/search/sort verified, unlisted+private excluded. |
