import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runScraper } from "./types.js";
import { getScraper, scrapers } from "./scrapers/index.js";

function parseArgs(argv: string[]): { save: boolean; scraperId?: string; list: boolean } {
  const out: { save: boolean; scraperId?: string; list: boolean } = {
    save: false,
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--save") out.save = true;
    else if (a === "--list") out.list = true;
    else if (a === "--scraper") out.scraperId = argv[++i];
    else if (a.startsWith("--scraper=")) out.scraperId = a.slice("--scraper=".length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const s of Object.values(scrapers)) {
      console.log(`${s.id}\t${s.name}\t${s.source}`);
    }
    return;
  }

  const scraper = getScraper(args.scraperId);
  const snapshot = await runScraper(scraper);
  const json = JSON.stringify(snapshot, null, 2);

  if (args.save) {
    const out = resolve(`data/${scraper.id}.json`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, json + "\n", "utf8");
    const withDishes = snapshot.restaurants.filter((r) => r.dishes.length > 0).length;
    console.error(
      `Saved ${out} — ${snapshot.restaurantCount} restaurants (${withDishes} with dishes today)`,
    );
  } else {
    process.stdout.write(json + "\n");
  }
}

const isEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
