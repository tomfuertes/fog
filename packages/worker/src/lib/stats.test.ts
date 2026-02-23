import { describe, it, expect } from "vitest";
import { bayesianProbability, multiVariantProbabilities } from "./stats";

describe("bayesianProbability", () => {
  it("returns a value between 0 and 1", () => {
    const p = bayesianProbability(50, 100, 60, 100);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("clear winner: treatment 1000 conversions vs control 10 should be > 0.95", () => {
    const p = bayesianProbability(10, 1000, 1000, 1000);
    expect(p).toBeGreaterThan(0.95);
  });

  it("clear loser: treatment 10 conversions vs control 1000 should be < 0.05", () => {
    const p = bayesianProbability(1000, 1000, 10, 1000);
    expect(p).toBeLessThan(0.05);
  });

  it("even match (500 vs 500) should be roughly 0.5", () => {
    const p = bayesianProbability(500, 1000, 500, 1000);
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.7);
  });

  it("zero data should be roughly 0.5 (uniform Beta(1,1) prior)", () => {
    const p = bayesianProbability(0, 0, 0, 0);
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.7);
  });
});

describe("multiVariantProbabilities", () => {
  it("returns null for control (index 0) and probabilities for others", () => {
    const probs = multiVariantProbabilities([
      { conversions: 50, total: 100 },
      { conversions: 60, total: 100 },
    ]);
    expect(probs).toHaveLength(2);
    expect(probs[0]).toBeNull();
    expect(probs[1]).toBeGreaterThanOrEqual(0);
    expect(probs[1]).toBeLessThanOrEqual(1);
  });

  it("3-variant: returns null for control, probabilities for B and C", () => {
    const probs = multiVariantProbabilities([
      { conversions: 50, total: 1000 },   // A - control
      { conversions: 500, total: 1000 },  // B - clear winner
      { conversions: 5, total: 1000 },    // C - clear loser
    ]);
    expect(probs).toHaveLength(3);
    expect(probs[0]).toBeNull();
    expect(probs[1]).toBeGreaterThan(0.95); // B dominates
    expect(probs[2]).toBeLessThan(0.05);    // C loses badly
  });

  it("4-variant: returns null for control, probabilities for B, C, D", () => {
    const probs = multiVariantProbabilities([
      { conversions: 100, total: 1000 },  // A - control 10%
      { conversions: 200, total: 1000 },  // B - strong winner 20%
      { conversions: 105, total: 1000 },  // C - roughly even
      { conversions: 10, total: 1000 },   // D - clear loser
    ]);
    expect(probs).toHaveLength(4);
    expect(probs[0]).toBeNull();
    expect(probs[1]).toBeGreaterThan(0.95); // B clearly beats A
    expect(probs[2]).toBeGreaterThan(0.3);  // C is roughly even with A
    expect(probs[2]).toBeLessThan(0.7);
    expect(probs[3]).toBeLessThan(0.05);    // D clearly loses to A
  });

  it("returns empty array for empty input", () => {
    expect(multiVariantProbabilities([])).toEqual([]);
  });

  it("returns [null] for a single variant (control only)", () => {
    const probs = multiVariantProbabilities([{ conversions: 10, total: 100 }]);
    expect(probs).toEqual([null]);
  });
});
