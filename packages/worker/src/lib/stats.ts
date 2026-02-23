/**
 * Normal approximation to Beta(alpha, beta) via Box-Muller transform.
 * Accurate enough for A/B testing with reasonable sample sizes (n > 30).
 * Clamps to [0,1] to handle the tail approximation error near boundaries.
 */
function sampleBeta(alpha: number, beta: number): number {
  const mu = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(1, mu + Math.sqrt(variance) * z));
}

/**
 * P(treatment beats control) via Beta-Binomial Monte Carlo (10k samples).
 * Prior: Beta(1,1) = uniform - no prior knowledge assumed.
 * Returns float in [0, 1].
 */
export function bayesianProbability(
  controlConversions: number,
  controlTotal: number,
  treatmentConversions: number,
  treatmentTotal: number
): number {
  // Clamp to valid Beta parameter range: conversions must not exceed total,
  // and totals must be non-negative. Prevents NaN from negative alpha/beta.
  const cc = Math.max(0, Math.min(controlConversions, controlTotal));
  const ct = Math.max(0, controlTotal);
  const tc = Math.max(0, Math.min(treatmentConversions, treatmentTotal));
  const tt = Math.max(0, treatmentTotal);

  const SAMPLES = 10_000;
  let wins = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const a = sampleBeta(cc + 1, ct - cc + 1);
    const b = sampleBeta(tc + 1, tt - tc + 1);
    if (b > a) wins++;
  }
  return wins / SAMPLES;
}

interface VariantData {
  conversions: number;
  total: number;
}

/**
 * Pairwise P(variant beats control) for each non-control variant.
 * Returns an array aligned with the input variants array:
 * - index 0 (control) always gets null
 * - index N gets P(variant N beats variant 0)
 */
export function multiVariantProbabilities(variants: VariantData[]): (number | null)[] {
  if (variants.length === 0) return [];
  const control = variants[0];
  return variants.map((v, i) => {
    if (i === 0) return null;
    return bayesianProbability(control.conversions, control.total, v.conversions, v.total);
  });
}
