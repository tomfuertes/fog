import { describe, it, expect } from "vitest";
import { fnv1a, bucket } from "./hash";

describe("fnv1a", () => {
  it("returns a number in [0, 1)", () => {
    expect(fnv1a("hello")).toBeGreaterThanOrEqual(0);
    expect(fnv1a("hello")).toBeLessThan(1);
    expect(fnv1a("")).toBeGreaterThanOrEqual(0);
    expect(fnv1a("")).toBeLessThan(1);
  });

  it("is deterministic", () => {
    expect(fnv1a("visitor-123")).toBe(fnv1a("visitor-123"));
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
  });

  it("distributes roughly uniformly across quartiles", () => {
    const inputs = Array.from({ length: 1000 }, (_, i) => `visitor-${i}`);
    const values = inputs.map(fnv1a);

    const q1 = values.filter((v) => v < 0.25).length;
    const q2 = values.filter((v) => v >= 0.25 && v < 0.5).length;
    const q3 = values.filter((v) => v >= 0.5 && v < 0.75).length;
    const q4 = values.filter((v) => v >= 0.75).length;

    // Each quartile should have roughly 250 values. Allow ±20% (200-300).
    for (const count of [q1, q2, q3, q4]) {
      expect(count).toBeGreaterThan(150);
      expect(count).toBeLessThan(350);
    }
  });
});

describe("bucket", () => {
  it("returns -1 when visitor hash is outside traffic allocation", () => {
    // With 1% traffic, most visitors should be excluded
    const excluded = Array.from({ length: 1000 }, (_, i) =>
      bucket(`visitor-${i}`, "exp-1", 2, 1)
    ).filter((v) => v === -1);
    expect(excluded.length).toBeGreaterThan(900);
  });

  it("returns valid variant indices (0 to variantCount-1)", () => {
    const variantCount = 3;
    const results = Array.from({ length: 1000 }, (_, i) =>
      bucket(`visitor-${i}`, "exp-2", variantCount, 100)
    );
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(variantCount - 1);
    }
  });

  it("is deterministic for same visitor+experiment", () => {
    const a = bucket("visitor-abc", "exp-xyz", 2, 100);
    const b = bucket("visitor-abc", "exp-xyz", 2, 100);
    expect(a).toBe(b);
  });

  it("with 100% traffic never returns -1", () => {
    const results = Array.from({ length: 1000 }, (_, i) =>
      bucket(`visitor-${i}`, "exp-3", 2, 100)
    );
    expect(results.every((r) => r !== -1)).toBe(true);
  });
});

describe("bucket - flag mode", () => {
  it("returns 1 (on) or 0 (off), never -1", () => {
    const results = Array.from({ length: 1000 }, (_, i) =>
      bucket(`visitor-${i}`, "flag-1", 1, 50, "flag")
    );
    expect(results.every((r) => r === 0 || r === 1)).toBe(true);
  });

  it("is ramp-stable: visitors on at 10% stay on at 50%", () => {
    const total = 1000;
    const onAt10 = Array.from({ length: total }, (_, i) =>
      bucket(`visitor-${i}`, "flag-ramp", 1, 10, "flag") === 1
    );
    const onAt50 = Array.from({ length: total }, (_, i) =>
      bucket(`visitor-${i}`, "flag-ramp", 1, 50, "flag") === 1
    );
    for (let i = 0; i < total; i++) {
      if (onAt10[i]) expect(onAt50[i]).toBe(true);
    }
  });

  it("returns 1 for all visitors at 100% traffic", () => {
    const results = Array.from({ length: 1000 }, (_, i) =>
      bucket(`visitor-${i}`, "flag-all", 1, 100, "flag")
    );
    expect(results.every((r) => r === 1)).toBe(true);
  });

  it("returns 0 for all visitors at 0% traffic", () => {
    const results = Array.from({ length: 1000 }, (_, i) =>
      bucket(`visitor-${i}`, "flag-none", 1, 0, "flag")
    );
    expect(results.every((r) => r === 0)).toBe(true);
  });
});
