export const READINESS_PROBE_CACHE_DEFAULT_TTL_MS = 5_000;
export const READINESS_PROBE_CACHE_MIN_TTL_MS = 250;
export const READINESS_PROBE_CACHE_MAX_TTL_MS = 30_000;

interface CachedProbeResult<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/**
 * One-key, one-value readiness cache. It is deliberately bounded and shares
 * one in-flight probe so concurrent load-balancer checks cannot amplify calls
 * to external providers.
 */
export class ReadinessProbeCache<T> {
  readonly ttlMs: number;
  readonly #load: () => Promise<T>;
  readonly #now: () => number;
  #cached: CachedProbeResult<T> | null = null;
  #inFlight: Promise<T> | null = null;

  constructor(input: {
    load: () => Promise<T>;
    ttlMs?: number;
    now?: () => number;
  }) {
    const ttlMs = input.ttlMs ?? READINESS_PROBE_CACHE_DEFAULT_TTL_MS;
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < READINESS_PROBE_CACHE_MIN_TTL_MS ||
      ttlMs > READINESS_PROBE_CACHE_MAX_TTL_MS
    ) {
      throw new RangeError(
        `Readiness probe cache TTL must be between ${String(
          READINESS_PROBE_CACHE_MIN_TTL_MS
        )} and ${String(READINESS_PROBE_CACHE_MAX_TTL_MS)} milliseconds.`
      );
    }
    this.ttlMs = ttlMs;
    this.#load = input.load;
    this.#now = input.now ?? Date.now;
  }

  get(): Promise<T> {
    const cached = this.#cached;
    if (cached !== null && cached.expiresAt > this.#now()) {
      return Promise.resolve(cached.value);
    }
    if (this.#inFlight !== null) return this.#inFlight;

    const inFlight = Promise.resolve()
      .then(this.#load)
      .then((value) => {
        this.#cached = {
          value,
          expiresAt: this.#now() + this.ttlMs
        };
        return value;
      })
      .finally(() => {
        if (this.#inFlight === inFlight) this.#inFlight = null;
      });
    this.#inFlight = inFlight;
    return inFlight;
  }
}
