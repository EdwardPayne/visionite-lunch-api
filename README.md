# visionite-lunch-api

Backend for a "what's for lunch right now?" guide for **Östersund, Sweden**.

It scrapes [matochmat.se/lunch/ostersund](https://www.matochmat.se/lunch/ostersund/),
caches the result in memory, and exposes a small JSON API. Built with **Node 20 +
TypeScript + Hono + cheerio**.

## About this repo

This API is built for an internal **Visionite** AI workshop. The challenge:
build the best "Where should we eat?" app — bonus points for the social /
lunch-buddy angle on the frontend.

This repo is just the data layer. Pull the menus from here, build whatever you
want on top:

- **[Try the API in the browser](http://localhost:3000/docs)** once it's running — Swagger UI lets you fire requests without writing any client code.
- **[Generate a typed TS client](#generating-typed-clients-for-the-future-vue-frontend)** from the OpenAPI spec — no hand-maintained types, no drift.
- **CORS is open** (`*`), so a Vue / React / Svelte / vanilla JS frontend on `localhost:5173` etc. can hit it directly during the workshop.

## Running the backend

### Prerequisites

- **Node.js 20+** (uses native `fetch` and ESM). Check with `node --version`.
- A working internet connection — the server scrapes matochmat.se on cold start.

### First-time setup

```bash
git clone <this-repo> lunch-ai   # or just cd into the existing folder
cd lunch-ai
npm install
```

That's it — no environment variables, no database, no build step.

### Start the server

```bash
npm start         # one-shot, production-style (no reload)
npm run dev       # development — auto-reload on file change (tsx watch)
```

You'll see something like:

```
lunch-ai server listening on http://localhost:3000
  GET  /docs             -> interactive API docs (Swagger UI)
  GET  /openapi.yaml     -> OpenAPI 3.1 spec
  GET  /lunches          -> full cached snapshot (all 27 restaurants)
  GET  /lunches?refresh=1 -> bypass cache
  GET  /restaurants      -> only places serving lunch right now
  GET  /health           -> cache status
  POST /refresh          -> force re-scrape
Cache TTL: 60 min, stale fallback: 24 h
```

The server listens on `http://localhost:3000`. Override the port with `PORT=4000 npm start`.

### Verify it works

```bash
curl localhost:3000/health                          # → {"ok":true,...}
curl localhost:3000/restaurants | jq '.restaurantCount'
open http://localhost:3000/docs                     # Swagger UI in your browser
```

The first `/lunches` or `/restaurants` request triggers a scrape and may take ~1 second. After that, responses are served from cache (sub-millisecond) for an hour.

## Endpoints

| Method | Path                  | What it returns                                                       |
| ------ | --------------------- | --------------------------------------------------------------------- |
| GET    | `/lunches`            | Full snapshot — all 27 restaurants, including ones with no menu today |
| GET    | `/lunches?refresh=1`  | Same, but bypasses the cache                                          |
| GET    | `/restaurants`        | Only restaurants actually serving lunch right now (priced dishes)     |
| POST   | `/refresh`            | Force a re-scrape                                                     |
| GET    | `/health`             | Cache status                                                          |
| GET    | `/docs`               | Swagger UI                                                            |
| GET    | `/openapi.yaml`       | OpenAPI 3.1 spec                                                      |

### Example

```bash
curl localhost:3000/restaurants | jq '.restaurants[] | {name, dishes: (.dishes | length)}'
```

## Response shape

All read endpoints return a `LunchSnapshot`:

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

Lunch menus barely change within a day, so the server caches the snapshot in memory:

- **Fresh TTL: 1 hour.** During this window, `/lunches` and `/restaurants` are served instantly with no upstream traffic.
- **Stale fallback: 24 hours.** If matochmat.se is down or blocks us, we keep serving the last good snapshot rather than a 502.
- **Request coalescing.** Concurrent cache misses share a single upstream fetch — 100 simultaneous requests on a cold cache produce **one** outgoing request.

Every cached response carries:

| Header                  | Meaning                                                |
| ----------------------- | ------------------------------------------------------ |
| `Cache-Control`         | `public, max-age=N` — remaining freshness in seconds   |
| `X-Cache`               | `FRESH` \| `MISS` \| `STALE`                           |
| `X-Cache-Age`           | Age of the snapshot, in seconds                        |
| `X-Cache-Fetched-At`    | When the snapshot was actually scraped (ISO-8601)      |

```bash
curl -i localhost:3000/lunches | grep -i x-cache
# X-Cache: FRESH
# X-Cache-Age: 137
# X-Cache-Fetched-At: 2026-05-02T06:55:02.150Z
```

## Project layout

```
src/
  types.ts                # shared types + the Scraper interface + runScraper()
  cache.ts                # in-memory single-value cache (stale fallback + coalescing)
  server.ts               # Hono HTTP server
  scrape.ts               # CLI entry point over the scraper registry
  scrapers/
    index.ts              # registry of all scrapers + getScraper() / defaultScraper
    matochmat.ts          # matochmat.se parser + createMatochmatScraper(city, citySlug)
data/
  matochmat-ostersund.json  # produced by `npm run scrape:save`; one file per scraper id
openapi.yaml              # API spec served at /openapi.yaml and rendered at /docs
```

### Adding a new scraper

A scraper is anything that implements [`Scraper`](src/types.ts):

```ts
export interface Scraper {
  readonly id: string;     // stable, URL-safe, e.g. "matochmat-stockholm"
  readonly name: string;   // human-readable
  readonly city: string;
  readonly source: string; // upstream URL (informational)
  scrape(): Promise<Restaurant[]>;
}
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
   The `runScraper()` helper in [`types.ts`](src/types.ts) will wrap your
   `Restaurant[]` into a full `LunchSnapshot` (date, weekday, etc.) for you.

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
npx openapi-typescript http://localhost:3000/openapi.yaml -o src/api-types.ts
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

const res = await fetch("http://localhost:3000/restaurants");
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

const api = createClient<paths>({ baseUrl: "http://localhost:3000" });
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
- **In-memory cache.** Vanishes on restart. Fine for a single instance; swap to
  Redis or a tiny disk write if you scale out.
- **Today only.** The site shows only the current day's menu, and so does this
  API. That's intentional — the app answers "where do I eat right now?", not
  "what's the weekly menu?".
- **Be polite.** The scraper sends a real `User-Agent` with a contact email and
  hits the source at most once per hour per server instance. Don't lower the TTL
  without good reason.
