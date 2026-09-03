import type {
  Dish,
  Restaurant,
  Scraper,
  WeekScrapeResult,
  WeekdaySlug,
} from "../types.js";
import { WEEKDAY_SLUGS } from "../types.js";

const BASE_URL = "https://www.matochmat.se";
const API_BASE = `${BASE_URL}/rest/v3`;
const USER_AGENT =
  "visionite-lunch-api/0.1 (workshop lunch guide; contact: marcus@souldrainer.com)";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { status?: boolean };
  if (body.status === false) {
    throw new Error(`GET ${url} -> API returned status:false`);
  }
  return body;
}

function parsePrice(raw: unknown): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\s+/g, "").replace(",", ".");
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
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

// --- matochmat REST API response shapes (only the fields we use) ---

type ApiWeekDate = {
  day: { slug: string; dayOfMonth: number };
  monthSet: { actualMonth: { number: number } };
  yearSet: { actualYear: { number: number } };
};

type ApiWeek = {
  number: number;
  yearSet: { weekYear: { number: number } };
  dates: ApiWeekDate[];
};

type ApiCity = { id: number };

type ApiRestaurant = {
  id: number;
  name: string;
  slug: string | null;
  pending: boolean;
  inLockdown: boolean;
};

type ApiMenu = {
  restaurantId: number;
  week: number;
  year: number;
  content: string;
};

type ApiListResponse<T> = { status: boolean; data: T[]; count: number };

async function fetchCurrentWeek(): Promise<{
  week: number;
  year: number;
  dateBySlug: Map<WeekdaySlug, string>;
}> {
  const body = (await fetchJson(`${API_BASE}/week`)) as {
    data: { currentlyShown: ApiWeek };
  };
  const shown = body.data?.currentlyShown;
  if (!shown || typeof shown.number !== "number" || !Array.isArray(shown.dates)) {
    throw new Error("matochmat: /week response missing currentlyShown week");
  }
  const year = shown.yearSet?.weekYear?.number;
  if (typeof year !== "number") {
    throw new Error("matochmat: /week response missing weekYear");
  }
  const dateBySlug = new Map<WeekdaySlug, string>();
  for (const d of shown.dates) {
    const slug = d.day?.slug as WeekdaySlug;
    if (!WEEKDAY_SLUGS.includes(slug)) continue;
    const yyyy = d.yearSet.actualYear.number;
    const mm = String(d.monthSet.actualMonth.number).padStart(2, "0");
    const dd = String(d.day.dayOfMonth).padStart(2, "0");
    dateBySlug.set(slug, `${yyyy}-${mm}-${dd}`);
  }
  return { week: shown.number, year, dateBySlug };
}

async function fetchCityId(citySlug: string): Promise<number> {
  const url = `${API_BASE}/cities?filter%5Bslug%5D=${encodeURIComponent(citySlug)}`;
  const body = (await fetchJson(url)) as ApiListResponse<ApiCity>;
  const city = body.data?.[0];
  if (!city || typeof city.id !== "number") {
    throw new Error(`matochmat: no city found for slug "${citySlug}"`);
  }
  return city.id;
}

async function fetchLunchRestaurants(cityId: number): Promise<ApiRestaurant[]> {
  const params = new URLSearchParams();
  params.set("filter[cityId]", String(cityId));
  params.set("filter[lunchFunctionality][active]", "true");
  const body = (await fetchJson(
    `${API_BASE}/restaurants?${params}`,
  )) as ApiListResponse<ApiRestaurant>;
  if (!Array.isArray(body.data)) {
    throw new Error("matochmat: restaurants response missing data array");
  }
  return body.data
    .filter((r) => !r.pending && !r.inLockdown)
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

async function fetchMenus(
  restaurantIds: number[],
  week: number,
  year: number,
): Promise<Map<number, Record<string, RawDish[]>>> {
  const params = new URLSearchParams();
  params.set("restaurantIds", restaurantIds.join(","));
  params.set("week", String(week));
  params.set("year", String(year));
  const body = (await fetchJson(
    `${API_BASE}/menus?${params}`,
  )) as ApiListResponse<ApiMenu>;
  if (!Array.isArray(body.data)) {
    throw new Error("matochmat: menus response missing data array");
  }
  const byRestaurant = new Map<number, Record<string, RawDish[]>>();
  for (const menu of body.data) {
    let parsed: Record<string, RawDish[]> = {};
    try {
      parsed = JSON.parse(menu.content) as Record<string, RawDish[]>;
    } catch {
      parsed = {};
    }
    byRestaurant.set(menu.restaurantId, parsed);
  }
  return byRestaurant;
}

export type MatochmatConfig = {
  city: string;
  citySlug: string;
};

export function createMatochmatScraper({ city, citySlug }: MatochmatConfig): Scraper {
  const source = `${BASE_URL}/restauranger/${citySlug}/lunch/`;
  return {
    id: `matochmat-${citySlug}`,
    name: `matochmat.se — ${city}`,
    city,
    source,
    async scrape(): Promise<WeekScrapeResult> {
      const { week, year, dateBySlug } = await fetchCurrentWeek();
      const cityId = await fetchCityId(citySlug);
      const restaurants = await fetchLunchRestaurants(cityId);
      if (restaurants.length === 0) {
        throw new Error(`matochmat: no lunch restaurants found for ${city}`);
      }
      const menus = await fetchMenus(
        restaurants.map((r) => r.id),
        week,
        year,
      );

      const days = {} as Record<WeekdaySlug, { date: string; restaurants: Restaurant[] }>;
      for (const slug of WEEKDAY_SLUGS) {
        days[slug] = { date: dateBySlug.get(slug) ?? "", restaurants: [] };
      }

      for (const rest of restaurants) {
        const content = menus.get(rest.id) ?? {};
        const url = rest.slug
          ? `${BASE_URL}/restauranger/${citySlug}/lunch/${rest.slug}/`
          : null;
        for (const slug of WEEKDAY_SLUGS) {
          const rawDishes = Array.isArray(content[slug]) ? content[slug] : [];
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
    },
  };
}

export const matochmatOstersund = createMatochmatScraper({
  city: "Östersund",
  citySlug: "ostersund",
});
