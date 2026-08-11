export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
}

export interface InMemoryRateLimiterOptions {
  windowMs: number;
  maximum: number;
  maxKeys?: number;
  now?: () => number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * Bounded process-local fixed-window limiter for the local demo. Production
 * deployments should enforce the same boundary at the gateway or shared store.
 */
export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly windowMs: number;
  private readonly maximum: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: InMemoryRateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maximum = options.maximum;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) throw new RangeError("Rate-limit window must be positive.");
    if (!Number.isInteger(this.maximum) || this.maximum <= 0) throw new RangeError("Rate-limit maximum must be positive.");
    if (!Number.isInteger(this.maxKeys) || this.maxKeys <= 0) throw new RangeError("Rate-limit key capacity must be positive.");
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    this.evict(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      while (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (!oldest) break;
        this.buckets.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const allowed = bucket.count <= this.maximum;
    return {
      allowed,
      remaining: Math.max(0, this.maximum - bucket.count),
      resetAt: new Date(bucket.resetAt).toISOString(),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))
    };
  }

  private evict(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
