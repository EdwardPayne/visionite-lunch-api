import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runScraper, type LunchSnapshot } from "./types.js";
import { defaultScraper } from "./scrapers/index.js";
import { SingleValueCache } from "./cache.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = resolve(__dirname, "..", "openapi.yaml");

const PORT = Number(process.env.PORT ?? 3000);
const TTL_MS = 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;

const scraper = defaultScraper;
const cache = new SingleValueCache<LunchSnapshot>({
  ttlMs: TTL_MS,
  staleMs: STALE_MS,
  load: () => runScraper(scraper),
});

const app = new Hono();
app.use("*", cors());

app.get("/openapi.yaml", async (c) => {
  const yaml = await readFile(OPENAPI_PATH, "utf8");
  c.header("Content-Type", "application/yaml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=300");
  return c.body(yaml);
});

app.get("/docs", swaggerUI({ url: "/openapi.yaml" }));

app.get("/health", (c) => {
  const peek = cache.peek();
  return c.json({
    ok: true,
    cached: peek !== null,
    cacheAgeSeconds: peek ? Math.floor((Date.now() - peek.fetchedAt) / 1000) : null,
  });
});

app.get("/lunches", async (c) => {
  const force = c.req.query("refresh") === "1";
  try {
    const result = await cache.get(force);
    const maxAge = Math.max(0, Math.floor(TTL_MS / 1000) - result.ageSeconds);
    c.header("Cache-Control", `public, max-age=${maxAge}`);
    c.header("X-Cache", result.state.toUpperCase());
    c.header("X-Cache-Age", String(result.ageSeconds));
    c.header("X-Cache-Fetched-At", new Date(result.fetchedAt).toISOString());
    return c.json(result.value);
  } catch (err) {
    console.error("scrape failed:", err);
    return c.json({ error: "Upstream scrape failed and no cache available." }, 502);
  }
});

app.get("/restaurants", async (c) => {
  try {
    const result = await cache.get(false);
    const open = result.value.restaurants.filter((r) =>
      r.dishes.some((d) => d.price !== null),
    );
    const maxAge = Math.max(0, Math.floor(TTL_MS / 1000) - result.ageSeconds);
    c.header("Cache-Control", `public, max-age=${maxAge}`);
    c.header("X-Cache", result.state.toUpperCase());
    c.header("X-Cache-Age", String(result.ageSeconds));
    c.header("X-Cache-Fetched-At", new Date(result.fetchedAt).toISOString());
    return c.json({
      city: result.value.city,
      source: result.value.source,
      scrapedAt: result.value.scrapedAt,
      date: result.value.date,
      weekday: result.value.weekday,
      restaurantCount: open.length,
      restaurants: open,
    });
  } catch (err) {
    console.error("scrape failed:", err);
    return c.json({ error: "Upstream scrape failed and no cache available." }, 502);
  }
});

app.post("/refresh", async (c) => {
  try {
    const result = await cache.get(true);
    return c.json({ ok: true, fetchedAt: new Date(result.fetchedAt).toISOString() });
  } catch (err) {
    console.error("refresh failed:", err);
    return c.json({ ok: false, error: String(err) }, 502);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`visionite-lunch-api listening on http://localhost:${info.port}`);
  console.log(`Active scraper: ${scraper.id} (${scraper.name})`);
  console.log(`  GET  /docs             -> interactive API docs (Swagger UI)`);
  console.log(`  GET  /openapi.yaml     -> OpenAPI 3.1 spec`);
  console.log(`  GET  /lunches          -> full cached snapshot (all 27 restaurants)`);
  console.log(`  GET  /lunches?refresh=1 -> bypass cache`);
  console.log(`  GET  /restaurants      -> only places serving lunch right now`);
  console.log(`  GET  /health           -> cache status`);
  console.log(`  POST /refresh          -> force re-scrape`);
  console.log(`Cache TTL: ${TTL_MS / 1000 / 60} min, stale fallback: ${STALE_MS / 1000 / 60 / 60} h`);
});
