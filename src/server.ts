import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  runScraper,
  projectDay,
  todayInStockholm,
  type WeekSnapshot,
} from "./types.js";
import { defaultScraper } from "./scrapers/index.js";
import { SingleValueCache } from "./cache.js";
import { auth, getCurrentUser, runAuthMigrations } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = resolve(__dirname, "..", "openapi.yaml");

const PORT = Number(process.env.PORT ?? 4010);
const HOSTNAME = process.env.HOST ?? "127.0.0.1";
const TTL_MS = 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;

const TRUSTED_ORIGINS = (process.env.TRUSTED_ORIGINS ?? "http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const scraper = defaultScraper;
const CACHE_PERSIST_PATH = process.env.CACHE_PERSIST_PATH
  ? resolve(process.env.CACHE_PERSIST_PATH)
  : resolve(__dirname, "..", "data", `cache-${scraper.id}.json`);

const cache = new SingleValueCache<WeekSnapshot>({
  ttlMs: TTL_MS,
  staleMs: STALE_MS,
  load: () => runScraper(scraper),
  persistPath: CACHE_PERSIST_PATH,
});

const app = new Hono();
app.use(
  "*",
  cors({
    origin: (origin) => (TRUSTED_ORIGINS.includes(origin) ? origin : TRUSTED_ORIGINS[0] ?? ""),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

function setCacheHeaders(
  c: Context,
  result: { state: string; ageSeconds: number; fetchedAt: number },
) {
  const maxAge = Math.max(0, Math.floor(TTL_MS / 1000) - result.ageSeconds);
  c.header("Cache-Control", `public, max-age=${maxAge}`);
  c.header("X-Cache", result.state.toUpperCase());
  c.header("X-Cache-Age", String(result.ageSeconds));
  c.header("X-Cache-Fetched-At", new Date(result.fetchedAt).toISOString());
}

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

app.get("/week", async (c) => {
  const force = c.req.query("refresh") === "1";
  try {
    const result = await cache.get(force);
    setCacheHeaders(c, result);
    return c.json(result.value);
  } catch (err) {
    console.error("scrape failed:", err);
    return c.json({ error: "Upstream scrape failed and no cache available." }, 502);
  }
});

app.get("/lunches", async (c) => {
  const force = c.req.query("refresh") === "1";
  try {
    const result = await cache.get(force);
    const today = todayInStockholm();
    const snapshot = projectDay(result.value, today.slug);
    setCacheHeaders(c, result);
    return c.json(snapshot);
  } catch (err) {
    console.error("scrape failed:", err);
    return c.json({ error: "Upstream scrape failed and no cache available." }, 502);
  }
});

app.get("/restaurants", async (c) => {
  try {
    const result = await cache.get(false);
    const today = todayInStockholm();
    const snapshot = projectDay(result.value, today.slug);
    const open = snapshot.restaurants.filter((r) =>
      r.dishes.some((d) => d.price !== null),
    );
    setCacheHeaders(c, result);
    return c.json({
      city: snapshot.city,
      source: snapshot.source,
      scrapedAt: snapshot.scrapedAt,
      date: snapshot.date,
      weekday: snapshot.weekday,
      restaurantCount: open.length,
      restaurants: open,
    });
  } catch (err) {
    console.error("scrape failed:", err);
    return c.json({ error: "Upstream scrape failed and no cache available." }, 502);
  }
});

app.get("/me", async (c) => {
  const user = await getCurrentUser(c);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  return c.json({ user });
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

await runAuthMigrations();

serve({ fetch: app.fetch, port: PORT, hostname: HOSTNAME }, (info) => {
  console.log(`visionite-lunch-api listening on http://${info.address}:${info.port}`);
  console.log(`Active scraper: ${scraper.id} (${scraper.name})`);
  console.log(`  GET  /docs             -> interactive API docs (Swagger UI)`);
  console.log(`  GET  /openapi.yaml     -> OpenAPI 3.1 spec`);
  console.log(`  GET  /week             -> full week snapshot (Mon–Sun)`);
  console.log(`  GET  /week?refresh=1   -> bypass cache`);
  console.log(`  GET  /lunches          -> today's snapshot (all listed restaurants)`);
  console.log(`  GET  /lunches?refresh=1 -> bypass cache`);
  console.log(`  GET  /restaurants      -> only places serving lunch right now`);
  console.log(`  GET  /health           -> cache status`);
  console.log(`  POST /refresh          -> force re-scrape`);
  console.log(`  *    /api/auth/*       -> better-auth (sign-up, sign-in, sign-out, session)`);
  console.log(`  GET  /me               -> current user (auth-gated example)`);
  console.log(`Cache TTL: ${TTL_MS / 1000 / 60} min, stale fallback: ${STALE_MS / 1000 / 60 / 60} h`);
});
