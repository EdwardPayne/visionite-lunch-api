# visionite-lunch-api

Backend for a "what's for lunch right now?" guide for **Östersund, Sweden**.

It scrapes [matochmat.se/lunch/ostersund](https://www.matochmat.se/lunch/ostersund/),
caches the result in memory, and exposes a small JSON API. Built with **Node 20 +
TypeScript + Hono + cheerio**.

## About this repo

This API is built for an internal **Visionite** AI workshop. The challenge:
build the best "Where should we eat?" app — bonus points for the social /
lunch-buddy angle.

### Workshop setup — for participants

**Each team clones this repo to their own machine and extends it.** There is
no shared hosted instance. Your fork is yours — change what you want.

What you get out of the box:

- **A working lunch data API** (`/week`, `/lunches`, `/restaurants`, `/health`,
  `/refresh`) backed by a scraper for matochmat.se and a 1-hour cache. These
  are the **locked workshop contract** — don't change their request/response
  shape, because everyone else (and your own typed clients) rely on it.
- **Restart-safe cache.** The scrape snapshot is persisted to `data/` and
  re-seeded on boot. Restart as often as you want — you won't re-hit
  matochmat.se for an hour. (Treat the source politely; don't lower the TTL
  to make it "fresher.")
- **An [optional auth layer](#optional-auth-better-auth--sqlite)** with email +
  password — pre-wired but un-gated by default. Use it if you want sign-up /
  sign-in for free, swap it for your own (Microsoft Entra, an API key, magic
  links, etc), or delete it entirely.
- **A typed TS client** you can generate from the OpenAPI spec — see
  [Generating typed clients](#generating-typed-clients-for-the-future-vue-frontend).
- **Open extension points.** Add new Hono routes, new scrapers (other cities
  or other sources), new SQLite tables for your buddy/match/voting feature —
  it's your fork.

What's locked vs. what's yours:

| Locked (don't break)                                            | Yours (do whatever)                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `/week`, `/lunches`, `/restaurants`, `/health`, `/refresh`      | New routes — buddy signals, matches, votes, favorites, etc.          |
| `LunchSnapshot` / `WeekSnapshot` / `Restaurant` / `Dish` shapes | New SQLite tables, new auth flow, frontend stack of your choice      |
| The matochmat.se scrape cadence (1h+ TTL)                       | The auth layer — keep it, replace it, or rip it out                  |

Once the server is running:

- **[Try the API in the browser](http://localhost:4010/docs)** — Swagger UI lets you fire requests without writing any client code.
- **CORS** allows the origins in `TRUSTED_ORIGINS` (defaults: `http://localhost:5173,http://localhost:3000`) with credentials enabled so auth cookies work. Add your frontend's origin there if it differs.

## Running the backend

### Prerequisites

- **Node.js 20+** (uses native `fetch` and ESM). Check with `node --version`.
- A working internet connection — the server scrapes matochmat.se on cold start.

### First-time setup

```bash
git clone git@github.com:EdwardPayne/visionite-lunch-api.git
cd visionite-lunch-api
npm install
cp .env.example .env    # only required if you change the auth secret or origins
```

For the lunch endpoints, no `.env` is needed — defaults work. For the optional auth, the bundled dev secret in `.env.example` is fine on `localhost`; replace it before deploying anywhere. The SQLite file (`data/auth.db`) is created automatically on first start; migrations run on every boot and are idempotent.

### Start the server

```bash
npm start         # one-shot, production-style (no reload)
npm run dev       # development — auto-reload on file change (tsx watch)
```

You'll see something like:

```
visionite-lunch-api listening on http://127.0.0.1:4010
  GET  /docs             -> interactive API docs (Swagger UI)
  GET  /openapi.yaml     -> OpenAPI 3.1 spec
  GET  /week             -> full week snapshot (Mon–Sun)
  GET  /week?refresh=1   -> bypass cache
  GET  /lunches          -> today's snapshot (all listed restaurants)
  GET  /lunches?refresh=1 -> bypass cache
  GET  /restaurants      -> only places serving lunch right now
  GET  /health           -> cache status
  POST /refresh          -> force re-scrape
  *    /api/auth/*       -> better-auth (sign-up, sign-in, sign-out, session)
  GET  /me               -> current user (auth-gated example)
Cache TTL: 60 min, stale fallback: 24 h
```

The server listens on `http://127.0.0.1:4010`. Override with `PORT=4000 npm start` or `HOST=0.0.0.0 npm start`.

### Verify it works

```bash
curl localhost:4010/health                          # → {"ok":true,...}
curl localhost:4010/restaurants | jq '.restaurantCount'
open http://localhost:4010/docs                     # Swagger UI in your browser
```

The first `/lunches` or `/restaurants` request triggers a scrape and may take ~1 second. After that, responses are served from cache (sub-millisecond) for an hour.

## Endpoints

| Method | Path                  | What it returns                                                                  |
| ------ | --------------------- | -------------------------------------------------------------------------------- |
| GET    | `/week`               | Full week (Mon–Sun) for all 27 restaurants                                       |
| GET    | `/week?refresh=1`     | Same, but bypasses the cache                                                     |
| GET    | `/lunches`            | Today's snapshot — all 27 restaurants, including ones with no menu today         |
| GET    | `/lunches?refresh=1`  | Same, but bypasses the cache                                                     |
| GET    | `/restaurants`        | Only restaurants actually serving lunch today (priced dishes)                    |
| POST   | `/refresh`            | Force a re-scrape                                                                |
| GET    | `/health`             | Cache status                                                                     |
| GET    | `/docs`               | Swagger UI                                                                       |
| GET    | `/openapi.yaml`       | OpenAPI 3.1 spec                                                                 |
| \*     | `/api/auth/*`         | better-auth — `sign-up/email`, `sign-in/email`, `sign-out`, `get-session`, ...   |
| GET    | `/me`                 | Auth-gated example: returns the current user or 401                              |

A single scrape returns the whole week, so `/lunches` and `/restaurants` are projections of the same cached `/week` snapshot — no extra upstream traffic for either view.

### Example

```bash
curl localhost:4010/restaurants | jq '.restaurants[] | {name, dishes: (.dishes | length)}'
```

## Response shape

`/lunches` and `/restaurants` return a `LunchSnapshot` (today's slice):

```ts
type LunchSnapshot = {
  city: string;            // "Östersund"
  source: string;          // upstream URL
  scrapedAt: string;       // ISO-8601, when matochmat.se was actually fetched
  date: string;            // "YYYY-MM-DD" (Europe/Stockholm)
  weekday: "Monday" | ... | "Sunday";
  restaurantCount: number;
  restaurants: Restaurant[];
};
```

`/week` returns a `WeekSnapshot` keyed by Swedish weekday slug:

```ts
type WeekSnapshot = {
  city: string;
  source: string;
  scrapedAt: string;
  week: number;            // ISO week
  year: number;
  days: {
    mandag:  DaySnapshot;
    tisdag:  DaySnapshot;
    onsdag:  DaySnapshot;
    torsdag: DaySnapshot;
    fredag:  DaySnapshot;
    lordag:  DaySnapshot;
    sondag:  DaySnapshot;
  };
};

type DaySnapshot = {
  weekday: "mandag" | ... | "sondag";
  date: string;            // "YYYY-MM-DD"
  restaurantCount: number;
  restaurants: Restaurant[];
};
```

`Restaurant` and `Dish` are shared between both shapes:

```ts
type Restaurant = {
  name: string;            // e.g. "Basta! Östersund"
  slug: string | null;     // matochmat.se slug
  url: string | null;      // link to the restaurant's page
  dishes: Dish[];
};

type Dish = {
  name: string;            // e.g. "Pasta Bolognese"
  description: string | null;
  price: number | null;    // numeric, e.g. 160
  currency: "SEK" | null;
  tags: string[];          // Swedish diet tags: "Vegansk", "Glutenfri", ...
};
```

See [`openapi.yaml`](openapi.yaml) or `/docs` for the authoritative schema.

## Caching

Lunch menus barely change within a day, so the server caches the scrape in memory with a disk-persisted snapshot to survive restarts:

- **Fresh TTL: 1 hour.** During this window, `/lunches` and `/restaurants` are served instantly with no upstream traffic.
- **Stale fallback: 24 hours.** If matochmat.se is down or blocks us, we keep serving the last good snapshot rather than a 502.
- **Request coalescing.** Concurrent cache misses share a single upstream fetch — 100 simultaneous requests on a cold cache produce **one** outgoing request.
- **Survives restarts.** The snapshot is written to `data/cache-<scraperId>.json` after every successful scrape and re-seeded on boot if it's younger than the stale window. `tsx watch` reloads, full restarts, even rebooting your laptop — none of them re-hit matochmat.se. Override the path with `CACHE_PERSIST_PATH`; delete the file to force a fresh scrape.

Every cached response carries:

| Header                  | Meaning                                                |
| ----------------------- | ------------------------------------------------------ |
| `Cache-Control`         | `public, max-age=N` — remaining freshness in seconds   |
| `X-Cache`               | `FRESH` \| `MISS` \| `STALE`                           |
| `X-Cache-Age`           | Age of the snapshot, in seconds                        |
| `X-Cache-Fetched-At`    | When the snapshot was actually scraped (ISO-8601)      |

```bash
curl -i localhost:4010/lunches | grep -i x-cache
# X-Cache: FRESH
# X-Cache-Age: 137
# X-Cache-Fetched-At: 2026-05-02T06:55:02.150Z
```

## Optional auth (better-auth + SQLite)

The repo ships with a working email + password auth layer so teams who want
"sign up, log in, build something behind a login" don't have to wire it
themselves. It's optional — the lunch endpoints stay anonymous regardless, and
you can delete `src/auth.ts` + remove the route mount in `src/server.ts` if you
don't want any of it.

**What's included**

- [`better-auth`](https://better-auth.com) configured with email + password and
  cookie sessions.
- A local SQLite database via libsql (no native compile step, no external
  service). Stored at `data/auth.db`; gitignored.
- All auth routes mounted at `/api/auth/*` — see better-auth's docs for the
  full list (`sign-up/email`, `sign-in/email`, `sign-out`, `get-session`,
  `update-user`, password reset, etc).
- A reference `/me` route in [`src/server.ts`](src/server.ts) showing how to
  gate an endpoint, and a `getCurrentUser(c)` helper exported from
  [`src/auth.ts`](src/auth.ts).
- Schema migrations run automatically on every server start (idempotent).

**Try it from curl**

```bash
# sign up — this also signs you in and sets a session cookie
curl -i -c cookies.txt -X POST http://localhost:4010/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:5173' \
  -d '{"email":"alice@example.com","password":"hunter2hunter2","name":"Alice"}'

# read the session
curl -b cookies.txt http://localhost:4010/me

# sign out
curl -b cookies.txt -c cookies.txt -X POST http://localhost:4010/api/auth/sign-out \
  -H 'Content-Type: application/json' -d '{}'
```

**Gating your own routes**

```ts
import { getCurrentUser } from "./auth.js";

app.post("/lunch-signals", async (c) => {
  const user = await getCurrentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);

  // ...your logic, scoped to user.id
});
```

**From the frontend**

better-auth ships matching client SDKs for [Vue](https://www.better-auth.com/docs/integrations/vue),
React, Svelte and vanilla. Point them at `baseURL: "http://localhost:4010"` and
include credentials on every fetch (the Vue/React clients do this for you).

**Config**

| Env var               | Default                                            | Purpose                                                       |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`  | dev fallback (rejected in production)              | Session signing. `openssl rand -base64 32`.                   |
| `BETTER_AUTH_URL`     | `http://localhost:4010`                            | Public URL your API is served from.                           |
| `TRUSTED_ORIGINS`     | `http://localhost:5173,http://localhost:3000`      | Comma-separated frontend origins (CORS + better-auth checks). |
| `AUTH_DB_PATH`        | `./data/auth.db`                                   | Where the SQLite file lives.                                  |

**Removing it**

If your team wants a different auth (Microsoft Entra ID, an API key, magic
links, none at all), delete `src/auth.ts`, drop the `import` and the
`/api/auth/*` mount in [`src/server.ts`](src/server.ts), and remove the
`better-auth`/`@libsql/*`/`kysely` dependencies from `package.json`. The lunch
endpoints don't depend on any of it.

## Project layout

```
src/
  types.ts                # shared types + the Scraper interface + runScraper()
  cache.ts                # in-memory single-value cache (stale fallback + coalescing)
  server.ts               # Hono HTTP server
  auth.ts                 # better-auth instance + getCurrentUser helper + migrations
  scrape.ts               # CLI entry point over the scraper registry
  scrapers/
    index.ts              # registry of all scrapers + getScraper() / defaultScraper
    matochmat.ts          # matochmat.se parser + createMatochmatScraper(city, citySlug)
data/                     # gitignored
  matochmat-ostersund.json     # produced by `npm run scrape:save`; one file per scraper id
  cache-matochmat-ostersund.json  # persisted snapshot — survives restarts
  auth.db                      # SQLite for better-auth (auto-created)
openapi.yaml              # API spec served at /openapi.yaml and rendered at /docs
.env.example              # copy to .env and customise
```

### Adding a new scraper

A scraper is anything that implements [`Scraper`](src/types.ts):

```ts
export interface Scraper {
  readonly id: string;     // stable, URL-safe, e.g. "matochmat-stockholm"
  readonly name: string;   // human-readable
  readonly city: string;
  readonly source: string; // upstream URL (informational)
  scrape(): Promise<WeekScrapeResult>;
}

type WeekScrapeResult = {
  week: number;
  year: number;
  days: Record<WeekdaySlug, { date: string; restaurants: Restaurant[] }>;
};
```

Two common patterns:

1. **Another city on the same source** — one line, reusing the matochmat factory:

   ```ts
   // src/scrapers/index.ts
   import { createMatochmatScraper } from "./matochmat.js";
   const matochmatStockholm = createMatochmatScraper({ city: "Stockholm", citySlug: "stockholm" });
   ```

2. **A different source entirely** — drop a new file in `src/scrapers/`, export an
   object that satisfies `Scraper`, and register it in `src/scrapers/index.ts`.
   The `runScraper()` helper in [`types.ts`](src/types.ts) wraps your
   `WeekScrapeResult` into a full `WeekSnapshot` (city, source, scrapedAt) for you.

The CLI picks one up automatically:

```bash
npm run scrape -- --list
npm run scrape -- --scraper=matochmat-ostersund --save
```

## Generating typed clients (for the future Vue frontend)

The OpenAPI spec is the single source of truth, so any frontend can generate
fully-typed TypeScript types directly from it — no hand-maintained interfaces,
no drift between backend and frontend.

With the server running:

```bash
npx openapi-typescript http://localhost:4010/openapi.yaml -o src/api-types.ts
```

Or against the file directly (no server needed):

```bash
npx openapi-typescript ./openapi.yaml -o src/api-types.ts
```

You'll get a `src/api-types.ts` with `paths` and `components` types. Use it like:

```ts
import type { components } from "./api-types";

type LunchSnapshot = components["schemas"]["LunchSnapshot"];
type Restaurant = components["schemas"]["Restaurant"];

const res = await fetch("http://localhost:4010/restaurants");
const data: LunchSnapshot = await res.json();
```

Pair it with [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) for a tiny,
fully-typed client that knows every path, query param, and response shape:

```bash
npm i openapi-fetch
```

```ts
import createClient from "openapi-fetch";
import type { paths } from "./api-types";

const api = createClient<paths>({ baseUrl: "http://localhost:4010" });
const { data, error } = await api.GET("/restaurants");
//      ^? typed as LunchSnapshot
```

Re-run `openapi-typescript` whenever `openapi.yaml` changes.

## CLI mode

The scraper runs standalone, no server needed:

```bash
npm run scrape                              # default scraper, JSON to stdout
npm run scrape:save                         # writes data/<scraper-id>.json
npm run scrape -- --list                    # list registered scrapers
npm run scrape -- --scraper=<id>            # pick a specific scraper
npm run scrape -- --scraper=<id> --save     # combine
```

## Honest caveats

- **Single source today.** All data currently comes from one site. The
  `Scraper` interface in [`src/types.ts`](src/types.ts) is designed so that
  per-restaurant fallback scrapers (or other aggregators) can be added without
  touching the server or cache layer — see [Adding a new scraper](#adding-a-new-scraper).
- **Single-process cache.** In-memory with a disk-persisted snapshot
  (`data/cache-<scraperId>.json`) — fine for one local instance per team.
  If you ever run multiple instances behind a load balancer, swap to Redis or
  a shared volume.
- **Whole week, served two ways.** A single scrape pulls the entire week
  (Mon–Sun) from matochmat.se's SSR payload. `/week` exposes that directly;
  `/lunches` and `/restaurants` keep their original "today" framing by
  projecting the right day out of the same cached snapshot.
- **Current week only.** matochmat.se hides next-week navigation behind a
  login wall, so this API only ever serves the current ISO week. The response's
  `week` and `year` tell you which one you got.
- **Be polite.** The scraper sends a real `User-Agent` with a contact email and
  hits the source at most once per hour per server instance. Don't lower the TTL
  without good reason.
