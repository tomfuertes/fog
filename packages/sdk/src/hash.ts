/**
 * FNV-1a hash - same algorithm used by GrowthBook for experiment bucketing.
 * Returns a float in [0, 1) for traffic allocation.
 */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Convert to [0, 1) range
  return ((hash >>> 0) % 10000) / 10000;
}

/** Returns the variant index for a visitor in an experiment, or -1 if excluded by traffic.
 *  type "flag": threshold check only (ramp-stable - visitors on at 10% stay on at 50%)
 *  type "experiment": rescale within traffic window to distribute across variants (default)
 */
export function bucket(
  visitorId: string,
  experimentId: string,
  variantCount: number,
  trafficPercent: number,
  type: "experiment" | "flag" = "experiment"
): number {
  const n = fnv1a(visitorId + experimentId);
  if (type === "flag") {
    return n < trafficPercent / 100 ? 1 : 0;
  }
  if (n >= trafficPercent / 100) return -1;
  // Scale within the traffic window to pick a variant
  const scaled = n / (trafficPercent / 100);
  return Math.min(Math.floor(scaled * variantCount), variantCount - 1);
}
