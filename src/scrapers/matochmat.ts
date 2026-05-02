import * as cheerio from "cheerio";
import type { Dish, Restaurant, Scraper } from "../types.js";

const BASE_URL = "https://www.matochmat.se";
const USER_AGENT =
  "lunch-ai-scraper/0.1 (personal lunch guide; contact: marcus@souldrainer.com)";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return await res.text();
}

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/\s+/g, "").replace(",", ".");
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function slugFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const parts = href.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

export function parseMatochmatPage(html: string, city: string, sourceUrl: string): Restaurant[] {
  const $ = cheerio.load(html);
  const citySuffix = new RegExp(`\\s+i\\s+${city}\\s*$`, "i");
  const restaurants: Restaurant[] = [];

  $(".restaurantListItemWithDishes").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find(".restaurantListItemWithDishes__restaurantLink").first();
    const href = linkEl.attr("href") ?? undefined;
    const url = href ? new URL(href, sourceUrl).toString() : null;

    const rawName =
      $el.find(".restaurantListItemWithDishes__restaurantLinkText").first().text().trim() ||
      (linkEl.attr("aria-label") ?? "").replace(/\s+lunchmeny\s*$/i, "").trim();
    const name = rawName.replace(citySuffix, "").trim();
    if (!name) return;

    const dishes: Dish[] = [];
    $el.find(".lunchDish").each((__, d) => {
      const $d = $(d);
      const dishName = $d.find(".lunchDish__name").first().text().trim();
      if (!dishName) return;

      const priceText = $d.find(".lunchDish__price").first().text().trim();
      const description = $d.find(".lunchDish__bottomRow").first().text().trim() || null;
      const tags = $d
        .find(".lunchDish__tag")
        .map((___, t) => $(t).text().trim())
        .get()
        .filter(Boolean);

      dishes.push({
        name: dishName,
        description,
        price: priceText ? parsePrice(priceText) : null,
        currency: priceText ? "SEK" : null,
        tags,
      });
    });

    restaurants.push({ name, slug: slugFromHref(href), url, dishes });
  });

  return restaurants;
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
      return parseMatochmatPage(html, city, source);
    },
  };
}

export const matochmatOstersund = createMatochmatScraper({
  city: "Östersund",
  citySlug: "ostersund",
});
