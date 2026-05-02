# Notes for Claude

This file briefs future Claude sessions on lunch-ai conventions that aren't
self-evident from the code. The user-facing docs live in `README.md` and
`openapi.yaml` — keep those authoritative; this file is just guardrails.

## Product scope

- **Today-only, right-now-only.** The app answers "where do I eat lunch right
  now?" — not "what's next Monday's menu?" Don't add weekly/weekday features,
  date query params, or menu archives without explicit user approval.
- **One city (Östersund).** The architecture supports more, but only add cities
  on user request.

## Caching

- TTL is **1 hour** (fresh), **24 hours** (stale fallback). Don't lower the TTL
  to make data "fresher" — the scraper hits a third-party site and politeness
  matters more than a few minutes of staleness.
- The cache is in-memory and per-process. If you find yourself wanting Redis,
  ask first; for the current scale it's overkill.

## Scrapers

- Every scraper implements `Scraper` from `src/types.ts` and lives in
  `src/scrapers/`. Register it in `src/scrapers/index.ts`.
- For another city on the same source, **reuse the factory** —
  `createMatochmatScraper({ city, citySlug })` — don't copy the parser.
- Some `.lunchDish` blocks on matochmat.se are footnotes ("Endast à la carte",
  buffé descriptions, etc.) and have `price: null`. The `/restaurants`
  endpoint filters them out via `price !== null` **on purpose**. If you "fix"
  this, you'll re-introduce noise like Tre Rum showing as open on Saturday.

## API contract

- `openapi.yaml` is the source of truth for the HTTP surface. Update it in the
  same change as any route or schema change — `npx openapi-typescript` clients
  depend on it.
- The response shape (`LunchSnapshot` → `Restaurant[]` → `Dish[]`) is shared
  between the server and the future Vue frontend. Breaking changes need a
  version bump.

## Tooling

- Node 20+, ESM, TypeScript via `tsx` (no build step).
- Run `npm run dev` for development (auto-reload), `npm start` for one-shot.
- `npm run scrape -- --list` shows registered scrapers.
