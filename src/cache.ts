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
};

export class SingleValueCache<T> {
  private entry: CacheEntry<T> | null = null;
  private inflight: Promise<T> | null = null;

  constructor(private readonly opts: LoaderOptions<T>) {}

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
        this.entry = { value, fetchedAt: Date.now() };
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
}
