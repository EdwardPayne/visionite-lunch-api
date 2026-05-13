import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
};

export type CacheState = "fresh" | "stale" | "miss";

export type CacheLoadResult<T> = {
  value: T;
  state: CacheState;
  fetchedAt: number;
  ageSeconds: number;
};

export type LoaderOptions<T> = {
  ttlMs: number;
  staleMs: number;
  load: () => Promise<T>;
  /**
   * Path to a JSON file used to survive restarts. Read once at construction
   * (any entry older than `staleMs` is discarded); rewritten after each
   * successful refresh. Workshop participants restart often; without this,
   * every restart hits matochmat.se.
   */
  persistPath?: string;
};

export class SingleValueCache<T> {
  private entry: CacheEntry<T> | null = null;
  private inflight: Promise<T> | null = null;

  constructor(private readonly opts: LoaderOptions<T>) {
    if (opts.persistPath) this.restoreFromDisk(opts.persistPath);
  }

  async get(force = false): Promise<CacheLoadResult<T>> {
    const now = Date.now();
    if (!force && this.entry && now - this.entry.fetchedAt < this.opts.ttlMs) {
      return this.toResult(this.entry, "fresh", now);
    }

    try {
      const value = await this.refresh();
      return this.toResult({ value, fetchedAt: Date.now() }, "miss", Date.now());
    } catch (err) {
      if (this.entry && now - this.entry.fetchedAt < this.opts.staleMs) {
        return this.toResult(this.entry, "stale", now);
      }
      throw err;
    }
  }

  private refresh(): Promise<T> {
    if (this.inflight) return this.inflight;
    this.inflight = this.opts
      .load()
      .then((value) => {
        const entry = { value, fetchedAt: Date.now() };
        this.entry = entry;
        if (this.opts.persistPath) this.persistToDisk(this.opts.persistPath, entry);
        return value;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  peek(): CacheEntry<T> | null {
    return this.entry;
  }

  private toResult(entry: CacheEntry<T>, state: CacheState, now: number): CacheLoadResult<T> {
    return {
      value: entry.value,
      state,
      fetchedAt: entry.fetchedAt,
      ageSeconds: Math.floor((now - entry.fetchedAt) / 1000),
    };
  }

  private restoreFromDisk(path: string): void {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`cache: ignoring corrupt persisted file at ${path}:`, err);
      return;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as CacheEntry<T>).fetchedAt !== "number" ||
      !("value" in parsed)
    ) {
      console.warn(`cache: ignoring persisted file with unexpected shape at ${path}`);
      return;
    }
    const entry = parsed as CacheEntry<T>;
    const age = Date.now() - entry.fetchedAt;
    if (age >= this.opts.staleMs) {
      return;
    }
    this.entry = entry;
    const ageMinutes = Math.floor(age / 60_000);
    console.log(`cache: restored snapshot from ${path} (age ${ageMinutes} min)`);
  }

  private persistToDisk(path: string, entry: CacheEntry<T>): void {
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(entry), "utf8");
      renameSync(tmp, path);
    } catch (err) {
      console.warn(`cache: failed to persist snapshot to ${path}:`, err);
    }
  }
}
