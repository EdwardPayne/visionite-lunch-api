export type Dish = {
  name: string;
  description: string | null;
  price: number | null;
  currency: "SEK" | null;
  tags: string[];
};

export type Restaurant = {
  name: string;
  slug: string | null;
  url: string | null;
  dishes: Dish[];
};

export const WEEKDAY_SLUGS = [
  "mandag",
  "tisdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lordag",
  "sondag",
] as const;

export type WeekdaySlug = (typeof WEEKDAY_SLUGS)[number];

export type DaySnapshot = {
  weekday: WeekdaySlug;
  date: string;
  restaurantCount: number;
  restaurants: Restaurant[];
};

export type WeekSnapshot = {
  city: string;
  source: string;
  scrapedAt: string;
  week: number;
  year: number;
  days: Record<WeekdaySlug, DaySnapshot>;
};

export type LunchSnapshot = {
  city: string;
  source: string;
  scrapedAt: string;
  date: string;
  weekday: string;
  restaurantCount: number;
  restaurants: Restaurant[];
};

export type WeekScrapeResult = {
  week: number;
  year: number;
  days: Record<WeekdaySlug, { date: string; restaurants: Restaurant[] }>;
};

export interface Scraper {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly source: string;
  scrape(): Promise<WeekScrapeResult>;
}

export async function runScraper(scraper: Scraper): Promise<WeekSnapshot> {
  const result = await scraper.scrape();
  const days = {} as Record<WeekdaySlug, DaySnapshot>;
  for (const slug of WEEKDAY_SLUGS) {
    const day = result.days[slug];
    days[slug] = {
      weekday: slug,
      date: day.date,
      restaurantCount: day.restaurants.length,
      restaurants: day.restaurants,
    };
  }
  return {
    city: scraper.city,
    source: scraper.source,
    scrapedAt: new Date().toISOString(),
    week: result.week,
    year: result.year,
    days,
  };
}

const ENGLISH_TO_SLUG: Record<string, WeekdaySlug> = {
  Monday: "mandag",
  Tuesday: "tisdag",
  Wednesday: "onsdag",
  Thursday: "torsdag",
  Friday: "fredag",
  Saturday: "lordag",
  Sunday: "sondag",
};

const SLUG_TO_ENGLISH: Record<WeekdaySlug, string> = {
  mandag: "Monday",
  tisdag: "Tuesday",
  onsdag: "Wednesday",
  torsdag: "Thursday",
  fredag: "Friday",
  lordag: "Saturday",
  sondag: "Sunday",
};

export function todayInStockholm(now: Date = new Date()): {
  slug: WeekdaySlug;
  english: string;
  date: string;
} {
  const english = now.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "Europe/Stockholm",
  });
  const date = now.toLocaleDateString("en-CA", {
    timeZone: "Europe/Stockholm",
  });
  const slug = ENGLISH_TO_SLUG[english];
  if (!slug) throw new Error(`Unrecognized weekday: ${english}`);
  return { slug, english, date };
}

export function projectDay(week: WeekSnapshot, slug: WeekdaySlug): LunchSnapshot {
  const day = week.days[slug];
  return {
    city: week.city,
    source: week.source,
    scrapedAt: week.scrapedAt,
    date: day.date,
    weekday: SLUG_TO_ENGLISH[slug],
    restaurantCount: day.restaurantCount,
    restaurants: day.restaurants,
  };
}
