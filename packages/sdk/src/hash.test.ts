import { describe, it, expect } from "vitest";
import { fnv1a, bucket } from "./hash.js";

describe("fnv1a()", () => {
  it("returns a float in [0, 1)", () => {
    const n = fnv1a("hello");
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
  });

  it("is deterministic", () => {
    expect(fnv1a("visitor-123")).toBe(fnv1a("visitor-123"));
  });

  it("produces different values for different inputs", () => {
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  it("handles empty string", () => {
    const n = fnv1a("");
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(1);
  });
});

describe("bucket()", () => {
  it("returns -1 when visitor is outside traffic allocation", () => {
    // Find a visitorId that hashes above 10% traffic
    // Use a known value - we test the boundary logic directly
    const result = bucket("excluded-visitor", "exp-1", 2, 0);
    expect(result).toBe(-1);
  });

  it("returns a valid variant index within range", () => {
    // 100% traffic ensures all visitors are assigned
    const result = bucket("visitor-abc", "exp-1", 3, 100);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(2);
  });

  it("is deterministic - same inputs always yield same variant", () => {
    const r1 = bucket("visitor-xyz", "exp-2", 2, 100);
    const r2 = bucket("visitor-xyz", "exp-2", 2, 100);
    expect(r1).toBe(r2);
  });

  it("distributes visitors across variants with 100% traffic", () => {
    const counts = [0, 0];
    for (let i = 0; i < 200; i++) {
      const v = bucket(`visitor-${i}`, "exp-dist", 2, 100);
      if (v >= 0) counts[v]++;
    }
    // Rough distribution check - each variant should get some traffic
    expect(counts[0]).toBeGreaterThan(50);
    expect(counts[1]).toBeGreaterThan(50);
  });

  it("respects traffic percentage - ~50% excluded at 50% traffic", () => {
    let assigned = 0;
    const total = 500;
    for (let i = 0; i < total; i++) {
      if (bucket(`visitor-${i}`, "exp-traffic", 2, 50) >= 0) assigned++;
    }
    // Should be roughly 50% assigned (allow ±15% tolerance)
    expect(assigned).toBeGreaterThan(total * 0.35);
    expect(assigned).toBeLessThan(total * 0.65);
  });
});

describe("bucket() - flag mode", () => {
  it("returns 1 (on) when visitor is within threshold, 0 (off) otherwise", () => {
    const on = bucket("visitor-abc", "flag-1", 1, 100, "flag");
    expect(on).toBe(1);
    const off = bucket("visitor-abc", "flag-1", 1, 0, "flag");
    expect(off).toBe(0);
  });

  it("is ramp-stable: visitors on at 10% stay on at 50%", () => {
    const total = 500;
    const onAt10 = Array.from({ length: total }, (_, i) =>
      bucket(`visitor-${i}`, "flag-ramp", 1, 10, "flag") === 1
    );
    const onAt50 = Array.from({ length: total }, (_, i) =>
      bucket(`visitor-${i}`, "flag-ramp", 1, 50, "flag") === 1
    );
    // Every visitor on at 10% must still be on at 50%
    for (let i = 0; i < total; i++) {
      if (onAt10[i]) expect(onAt50[i]).toBe(true);
    }
  });

  it("~10% of visitors are on at 10% traffic", () => {
    const total = 1000;
    const on = Array.from({ length: total }, (_, i) =>
      bucket(`visitor-${i}`, "flag-pct", 1, 10, "flag")
    ).filter((v) => v === 1).length;
    expect(on).toBeGreaterThan(total * 0.05);
    expect(on).toBeLessThan(total * 0.20);
  });

  it("never returns -1", () => {
    const results = Array.from({ length: 200 }, (_, i) =>
      bucket(`visitor-${i}`, "flag-binary", 1, 50, "flag")
    );
    expect(results.every((r) => r === 0 || r === 1)).toBe(true);
  });
});
