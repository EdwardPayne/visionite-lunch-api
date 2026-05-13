# Notes for Claude

This file briefs future Claude sessions on visionite-lunch-api conventions that aren't
self-evident from the code. The user-facing docs live in `README.md` and
`openapi.yaml` — keep those authoritative; this file is just guardrails.

## Product scope

- **Current week only.** A single scrape returns the **current** ISO week
  (Mon–Sun) from matochmat.se's SSR payload. `/week` exposes that; `/lunches`
  and `/restaurants` are today-projections off the same cached snapshot.
- **Future weeks are not available from this source.** matochmat gates the
  next-week navigation behind `/konto/logga-in/` — anonymous requests always
  receive the current week regardless of `?week=` / `?vecka=` params or path
  variants like `/lunch/ostersund/2026-W19/` (404). Don't add a "next week"
  endpoint without first finding an alternative source. Past-week archives
  also require explicit user approval before adding.
- **One city (Östersund).** The architecture supports more, but only add cities
  on user request.

## Caching

- TTL is **1 hour** (fresh), **24 hours** (stale fallback). Don't lower the TTL
  to make data "fresher" — the scraper hits a third-party site and politeness
  matters more than a few minutes of staleness.
- The cache is in-memory **and** persisted to `data/cache-<scraperId>.json` so
  a restart doesn't re-scrape. On boot, `SingleValueCache` reads the file and
  seeds itself if the entry is younger than `staleMs`. The write happens after
  every successful refresh (atomic via tmp + rename). If you find yourself
  wanting Redis, ask first; for workshop scale this is enough.

## Scrapers

- Every scraper implements `Scraper` from `src/types.ts` and lives in
  `src/scrapers/`. Register it in `src/scrapers/index.ts`.
- For another city on the same source, **reuse the factory** —
  `createMatochmatScraper({ city, citySlug })` — don't copy the parser.
- The matochmat scraper parses the page's `<script id="ssr-setup-data">` JSON
  blob, not the rendered DOM. `restaurantData` gives the city's restaurants;
  `lunchMenuData[].content` is per-restaurant week JSON keyed by `mandag`…`sondag`.
  Filter `lunchMenuData` to restaurants in `restaurantData` (the menu array is
  cross-city). If matochmat ever drops/renames the SSR blob, fall back to the
  CSS-selector parser pattern that's preserved in git history.
- Some dishes in the source have `price: null` (no price published, footnote
  rows). The `/restaurants` endpoint filters restaurants whose dishes are all
  unpriced via `dishes.some(d => d.price !== null)` **on purpose** — without
  it, places with footnote-only entries show as "open" on days they aren't.

## API contract

- `openapi.yaml` is the source of truth for the HTTP surface. Update it in the
  same change as any route or schema change — `npx openapi-typescript` clients
  depend on it.
- The response shapes (`WeekSnapshot { days: { mandag: DaySnapshot, … } }` and
  `LunchSnapshot → Restaurant[] → Dish[]`) are shared between the server and
  the future Vue frontend. Breaking changes need an `openapi.yaml` version bump.
- The lunch read endpoints (`/week`, `/lunches`, `/restaurants`) are the
  **locked workshop contract** — teams fork this repo, so don't change their
  shape without a deliberate version bump.

## Auth

- Auth is **optional** and shipped as a reference for workshop forks: better-auth
  + email/password + libsql SQLite, in `src/auth.ts`, mounted at `/api/auth/*`.
  `/me` is a sample auth-gated route showing how to use `getCurrentUser(c)`.
- Lunch endpoints stay anonymous regardless — never add an auth check to
  `/week`, `/lunches`, `/restaurants`, `/refresh`, or `/health`.
- Migrations run at server start via `runAuthMigrations()` (idempotent).
  Don't move them to a separate script — workshop expectation is that
  `npm run dev` just works after `npm install`.
- Use libsql (`@libsql/kysely-libsql`), **not** `better-sqlite3`. The native
  build of better-sqlite3 fails on machines without Xcode CLT, which is
  exactly the friction the workshop is meant to skip.
- CORS uses `credentials: true` with an allowlist from `TRUSTED_ORIGINS`; the
  old wildcard `cors()` breaks cookie-based auth. Don't revert it.

## Tooling

- Node 20+, ESM, TypeScript via `tsx` (no build step).
- Run `npm run dev` for development (auto-reload), `npm start` for one-shot.
- `npm run scrape -- --list` shows registered scrapers.
