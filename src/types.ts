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

export type LunchSnapshot = {
  city: string;
  source: string;
  scrapedAt: string;
  date: string;
  weekday: string;
  restaurantCount: number;
  restaurants: Restaurant[];
};

export interface Scraper {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly source: string;
  scrape(): Promise<Restaurant[]>;
}

export async function runScraper(scraper: Scraper): Promise<LunchSnapshot> {
  const restaurants = await scraper.scrape();
  const now = new Date();
  return {
    city: scraper.city,
    source: scraper.source,
    scrapedAt: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    weekday: now.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "Europe/Stockholm",
    }),
    restaurantCount: restaurants.length,
    restaurants,
  };
}
