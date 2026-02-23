/**
 * FNV-1a hash - duplicated from SDK (10 lines, not worth a shared package).
 * Returns a float in [0, 1) for traffic allocation.
 */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

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
  const scaled = n / (trafficPercent / 100);
  return Math.min(Math.floor(scaled * variantCount), variantCount - 1);
}
