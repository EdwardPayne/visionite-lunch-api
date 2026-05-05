# Hosting & auth — planning notes

Status: **brainstorming, no commitments**. Captured 2026-05-05 to revisit later.

Nothing here is implemented or decided. The current API is still anonymous, in-memory cached, and runs locally only.

---

## What triggered this

The workshop API may need to grow beyond anonymous lunch data:

- Users register
- Users mark themselves "up for lunch" / "looking for a buddy"
- Users decide on a restaurant together / link up with other "looking" users

That implies persistent storage and authentication, which the current single-process / in-memory design doesn't support.

## Hosting options considered

For a low-traffic Node + Hono workshop API, three shapes make sense:

1. **Fly.io / Railway / Render — managed PaaS, always-on Node process**
   - Fits the existing in-memory cache (one long-running instance).
   - Managed Postgres available as an add-on if/when needed.
   - Free / hobby tiers cover this scale.

2. **Supabase as the storage + auth layer**
   - Postgres + auth + JS SDK out of the box.
   - Fastest to ship auth.
   - Tradeoff: contestants could hit Supabase directly and bypass our API, splitting the architecture. Pick this only if that's acceptable.

3. **Fly.io + SQLite on a volume (or Turso for libSQL replication)**
   - Single file DB, no separate database service.
   - Cleanest extension of the current "one process, one cache" design.
   - Auth still needs a small library (lucia-auth, better-auth).

**Not a fit:** serverless platforms (Vercel / Cloudflare Workers / Lambda). Cold starts would invalidate the in-memory cache between requests, forcing extra scrapes against matochmat.se. Bolting on Redis/KV to fix it adds complexity the project has explicitly avoided.

## Recommended direction (if/when we build this)

**Fly.io + SQLite-on-volume (or Turso) + SSO via Visionite's identity provider.**

- Same deployment shape as today: one always-on Node process.
- SQLite avoids running a separate DB service for workshop scale.
- SSO (Microsoft/Google, whatever Visionite already uses) means no password storage and identities map to real coworkers — which is what "lunch buddy" actually means. Magic-link is an acceptable fallback if SSO is too much setup for a workshop.
- `lucia-auth` or `better-auth` handles session plumbing in ~50 lines.

## Schema sketch

Thin domain — three tables would cover the buddy feature:

- **`users`** — `id`, display name, email (or SSO subject), `created_at`
- **`lunch_signals`** — `user_id`, status (`looking` | `committed`), `expires_at` (auto-clears at end of lunch hour), optional `restaurant_slug`, optional `note`
- **`buddy_matches`** — `user_a`, `user_b`, signal ids, `created_at` (created when two `looking` signals link up)

Time-bounded data (signals expire same day) keeps the tables from accumulating state forever.

## API surface impact

- Lunch/restaurant endpoints stay **anonymous** — the scrape data is the public contract for contestants and shouldn't require auth.
- New endpoints for the buddy feature (`/me`, `/signals`, `/buddies`) would be auth-gated.
- Cleanly separable so the existing `LunchSnapshot` / `WeekSnapshot` contract is untouched.

## Open questions to answer before building

1. **Who is logging in?** Visionite employees only, workshop contestants, or end-users in general? Determines whether SSO is appropriate.
2. **What is the "other DB stuff"?** If it's only buddy signals, the schema above is enough. If it grows (favorites, history, votes), revisit before the first migration.
3. **Retention policy.** Sweden / EU / internal coworkers means GDPR applies. Decide retention rules *before* the schema (e.g. signals auto-delete same day, accounts deletable on request). Shapes the table design and the auth choice.
4. **Does this API host the buddy feature, or do contestants build it themselves?** The whole reason this API exists is to let contestants skip boring backend work. Providing buddy storage out of the box is a strong workshop boost — but it expands operational scope (PII, sessions, migrations).
