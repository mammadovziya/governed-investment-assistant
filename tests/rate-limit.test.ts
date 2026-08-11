import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../src/services/rate-limit.js";

describe("InMemoryRateLimiter", () => {
  it("enforces a bounded window and resets after expiry", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter({ windowMs: 1_000, maximum: 2, now: () => now });

    expect(limiter.consume("client")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("client")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("client")).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    now = 2_001;
    expect(limiter.consume("client")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("keeps keys independent", () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 60_000, maximum: 1 });
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    expect(limiter.consume("b").allowed).toBe(true);
  });
});
