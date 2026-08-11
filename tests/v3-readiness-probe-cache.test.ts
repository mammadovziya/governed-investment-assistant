import { describe, expect, it, vi } from "vitest";
import {
  READINESS_PROBE_CACHE_MAX_TTL_MS,
  READINESS_PROBE_CACHE_MIN_TTL_MS,
  ReadinessProbeCache
} from "../src/assistant-v3/readiness-probe-cache.js";

describe("ReadinessProbeCache", () => {
  it("shares one in-flight load across concurrent callers", async () => {
    let releaseLoad: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const load = vi.fn(async () => {
      await gate;
      return { ready: true };
    });
    const cache = new ReadinessProbeCache({
      load,
      ttlMs: READINESS_PROBE_CACHE_MIN_TTL_MS
    });

    const pending = Array.from({ length: 24 }, () => cache.get());
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();

    releaseLoad?.();
    await expect(Promise.all(pending)).resolves.toEqual(
      Array.from({ length: 24 }, () => ({ ready: true }))
    );
  });

  it("reuses a value only within its bounded TTL", async () => {
    let now = 1_000;
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    const cache = new ReadinessProbeCache({
      load,
      ttlMs: READINESS_PROBE_CACHE_MIN_TTL_MS,
      now: () => now
    });

    await expect(cache.get()).resolves.toBe(1);
    now += READINESS_PROBE_CACHE_MIN_TTL_MS - 1;
    await expect(cache.get()).resolves.toBe(1);
    expect(load).toHaveBeenCalledOnce();

    now += 1;
    await expect(cache.get()).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not retain a failed load", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("private dependency detail"))
      .mockResolvedValueOnce("ready");
    const cache = new ReadinessProbeCache({
      load,
      ttlMs: READINESS_PROBE_CACHE_MIN_TTL_MS
    });

    await expect(cache.get()).rejects.toThrow("private dependency detail");
    await expect(cache.get()).resolves.toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each([
    READINESS_PROBE_CACHE_MIN_TTL_MS - 1,
    READINESS_PROBE_CACHE_MAX_TTL_MS + 1,
    1.5,
    Number.NaN
  ])("rejects an unsafe TTL of %s", (ttlMs) => {
    expect(
      () =>
        new ReadinessProbeCache({
          load: async () => true,
          ttlMs
        })
    ).toThrow(RangeError);
  });
});
