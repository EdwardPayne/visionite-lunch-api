# Hosting & auth — workshop decisions

Status: **decided 2026-05-13**. Earlier brainstorming (Fly.io + SSO + hosted
buddy feature) is superseded by the workshop direction below.

---

## Decision

For the AI workshop, teams **fork/clone the backend and run it locally**. The
shared deliverable is the data layer (scrape + cache + locked read endpoints).
Everything above that — auth, user-facing features, persistence beyond scrape
state — is each team's call inside their own fork.

This rules out hosting a shared production backend with central auth. There is
no shared user identity across teams.

### What we ship in the repo

- **Locked, anonymous read endpoints** — `/week`, `/lunches`, `/restaurants`,
  `/health`, `/refresh`, `/docs`, `/openapi.yaml`. These are the workshop
  contract; teams can rely on the shape and the in-memory cache.
- **An optional auth reference** — better-auth + email/password + SQLite,
  pre-wired in `src/auth.ts` and mounted at `/api/auth/*`, plus a sample
  `/me` route showing how to gate routes with `getCurrentUser(c)`. Teams keep,
  replace, or remove it; the scrape endpoints work either way.
- **No buddy/matching feature in this repo.** That's the workshop prompt —
  teams build it themselves on top of their fork.

### What we explicitly didn't ship

- **No shared hosting.** Each team's app runs against their own clone.
- **No SSO / Microsoft Entra ID** out of the box. Visionite is on M365, but
  forcing every team into Entra would lock the workshop into one provider
  setup. Teams who want SSO swap better-auth for their preferred flow.
- **No Postgres / Redis / managed DB.** Local SQLite is enough for a
  half-day workshop on a single machine.

## Why these picks

**better-auth over Lucia, hand-rolled, or hosted (Clerk/Auth0):**
- Active maintenance (Lucia is sunset).
- Email/password + cookie sessions out of the box, no email provider needed.
- Frontend SDKs for Vue / React / Svelte / vanilla, all opt-in.
- Teams who don't want auth at all can delete one file.

**libsql (via `@libsql/kysely-libsql`) over `better-sqlite3`:**
- No native compile step. `better-sqlite3` requires a working C++ toolchain
  (Xcode CLT on macOS) which is exactly the kind of "first 30 minutes
  debugging your machine" friction the workshop is meant to skip.
- Same SQLite file format; portable.

**Cookie sessions over JWT:**
- One less moving part on the frontend (no token storage / refresh logic).
- Works with the existing CORS + `credentials: true` setup.

## Caching: untouched

Adding auth did not change the scrape cache. The 1-hour fresh / 24-hour stale
TTLs and the in-memory `SingleValueCache` are unchanged. Authenticated and
anonymous requests both share the same cached snapshot — auth never causes an
extra scrape.

## Open items teams will face in their forks

If a team decides to ship something past the workshop, these are the next
decisions — not blockers for the AW session itself:

1. **Persistence beyond signals.** SQLite-on-disk is fine for local development;
   moving to Fly.io / Railway with a volume is straightforward.
2. **Real SSO.** Swap better-auth's `emailAndPassword` for one of its OAuth
   providers (Microsoft, Google) or a SAML plugin.
3. **GDPR / retention.** Anything that stores PII (users, signals, matches)
   needs a deletion path. Easiest pattern: time-bounded rows (e.g. signals
   auto-expire at end of day).
4. **Hosting.** If the buddy feature ever becomes shared rather than per-team,
   Fly.io + SQLite-on-volume (or Turso) is still the recommended shape — it
   matches the one-process, one-cache design.

These were the items the original planning doc dug into; the relevant detail
is still in git history (`git log -- docs/planning-hosting-and-auth.md`).
