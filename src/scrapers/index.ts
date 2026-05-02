import type { Scraper } from "../types.js";
import { matochmatOstersund } from "./matochmat.js";

export const scrapers: Record<string, Scraper> = {
  [matochmatOstersund.id]: matochmatOstersund,
};

export const defaultScraper: Scraper = matochmatOstersund;

export function getScraper(id?: string): Scraper {
  if (!id) return defaultScraper;
  const found = scrapers[id];
  if (!found) {
    const known = Object.keys(scrapers).join(", ");
    throw new Error(`Unknown scraper "${id}". Known: ${known}`);
  }
  return found;
}
