import * as cheerio from "cheerio";
import type {
  Dish,
  Restaurant,
  Scraper,
  WeekScrapeResult,
  WeekdaySlug,
} from "../types.js";
import { WEEKDAY_SLUGS } from "../types.js";

const BASE_URL = "https://www.matochmat.se";
const USER_AGENT =
  "visionite-lunch-api/0.1 (workshop lunch guide; contact: marcus@souldrainer.com)";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return await res.text();
}

function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\s+/g, "").replace(",", ".");
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function isoWeekDate(year: number, week: number, weekdayIndex: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayMon0 = (jan4.getUTCDay() + 6) % 7;
  const week1MondayMs = jan4.getTime() - jan4DayMon0 * 86_400_000;
  const targetMs = week1MondayMs + ((week - 1) * 7 + weekdayIndex) * 86_400_000;
  return new Date(targetMs).toISOString().slice(0, 10);
}

type RawDish = {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  tags?: unknown;
};

function toDish(raw: RawDish): Dish | null {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : null;
  const price = parsePrice(raw.price);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];
  return {
    name,
    description,
    price,
    currency: price !== null ? "SEK" : null,
    tags,
  };
}

type SsrRestaurant = {
  id: number;
  name: string;
  slug: string | null;
};

type SsrLunchMenu = {
  restaurantId: number;
  week: number;
  year: number;
  content: string;
};

type SsrPayload = {
  restaurantData: SsrRestaurant[];
  lunchMenuData: SsrLunchMenu[];
};

export function extractSsrPayload(html: string): SsrPayload {
  const $ = cheerio.load(html);
  const raw = $("#ssr-setup-data").html();
  if (!raw) throw new Error("matochmat: <script id='ssr-setup-data'> not found");
  const data = JSON.parse(raw) as SsrPayload;
  if (!Array.isArray(data.restaurantData) || !Array.isArray(data.lunchMenuData)) {
    throw new Error("matochmat: SSR payload missing restaurantData/lunchMenuData");
  }
  return data;
}

export function buildWeekFromSsr(
  data: SsrPayload,
  citySlug: string,
): WeekScrapeResult {
  const restaurantsById = new Map<number, SsrRestaurant>();
  for (const r of data.restaurantData) restaurantsById.set(r.id, r);

  const menusForCity = data.lunchMenuData.filter((m) =>
    restaurantsById.has(m.restaurantId),
  );
  if (menusForCity.length === 0) {
    throw new Error("matochmat: no lunch menus for any restaurant in city");
  }

  const week = menusForCity[0].week;
  const year = menusForCity[0].year;

  const days = {} as Record<WeekdaySlug, { date: string; restaurants: Restaurant[] }>;
  for (let i = 0; i < WEEKDAY_SLUGS.length; i++) {
    const slug = WEEKDAY_SLUGS[i];
    days[slug] = { date: isoWeekDate(year, week, i), restaurants: [] };
  }

  const sorted = [...restaurantsById.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "sv"),
  );

  for (const rest of sorted) {
    const menu = menusForCity.find((m) => m.restaurantId === rest.id);
    let parsed: Record<string, RawDish[]> = {};
    if (menu) {
      try {
        parsed = JSON.parse(menu.content) as Record<string, RawDish[]>;
      } catch {
        parsed = {};
      }
    }
    const url = rest.slug ? `${BASE_URL}/lunch/${citySlug}/${rest.slug}/` : null;
    for (const slug of WEEKDAY_SLUGS) {
      const rawDishes = Array.isArray(parsed[slug]) ? parsed[slug] : [];
      const dishes = rawDishes.map(toDish).filter((d): d is Dish => d !== null);
      days[slug].restaurants.push({
        name: rest.name,
        slug: rest.slug ?? null,
        url,
        dishes,
      });
    }
  }

  return { week, year, days };
}

export type MatochmatConfig = {
  city: string;
  citySlug: string;
};

export function createMatochmatScraper({ city, citySlug }: MatochmatConfig): Scraper {
  const source = `${BASE_URL}/lunch/${citySlug}/`;
  return {
    id: `matochmat-${citySlug}`,
    name: `matochmat.se — ${city}`,
    city,
    source,
    async scrape() {
      const html = await fetchHtml(source);
      const payload = extractSsrPayload(html);
      return buildWeekFromSsr(payload, citySlug);
    },
  };
}

export const matochmatOstersund = createMatochmatScraper({
  city: "Östersund",
  citySlug: "ostersund",
});
