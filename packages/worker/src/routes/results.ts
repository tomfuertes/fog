import type { Env, Experiment } from "../types";
import { corsHeaders } from "../lib/cors";
import { multiVariantProbabilities } from "../lib/stats";

// Analytics Engine doesn't support parameterized queries - whitelist UUID charset
const SAFE_ID = /^[a-f0-9-]+$/;

interface AERow {
  variant: string;
  eventType: string;
  count: number;
}

interface AERevenueRow {
  variant: string;
  total_revenue: number;
}

interface AEResponse<T> {
  data: T[];
}

async function queryAnalyticsEngine<T>(env: Env, sql: string): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: sql,
    }
  );
  if (!res.ok) {
    throw new Error(`Analytics Engine error: ${res.status}`);
  }
  const json = (await res.json()) as AEResponse<T>;
  return json.data ?? [];
}

export async function handleResults(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const origin = request.headers.get("Origin");
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin, true) };

  const match = pathname.match(/^\/api\/results\/([^/]+)$/);
  const experimentId = match?.[1] ?? "";

  if (!SAFE_ID.test(experimentId)) {
    return new Response(JSON.stringify({ error: "Invalid experiment ID" }), { status: 400, headers });
  }

  let rows: AERow[];
  let revenueRows: AERevenueRow[];
  try {
    [rows, revenueRows] = await Promise.all([
      queryAnalyticsEngine<AERow>(
        env,
        `SELECT blob2 as variant, blob3 as eventType, count() as count FROM fog_events WHERE blob1 = '${experimentId}' GROUP BY variant, eventType`
      ),
      queryAnalyticsEngine<AERevenueRow>(
        env,
        `SELECT blob2 as variant, SUM(double1) as total_revenue FROM fog_events WHERE blob1 = '${experimentId}' AND double1 > 0 GROUP BY variant`
      ),
    ]);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers });
  }

  // Aggregate per-variant
  const stats: Record<string, { impressions: number; conversions: number; totalRevenue: number }> = {};
  for (const row of rows) {
    if (!stats[row.variant]) stats[row.variant] = { impressions: 0, conversions: 0, totalRevenue: 0 };
    if (row.eventType === "impression") stats[row.variant].impressions += Number(row.count);
    else if (row.eventType === "conversion") stats[row.variant].conversions += Number(row.count);
  }
  for (const row of revenueRows) {
    if (!stats[row.variant]) stats[row.variant] = { impressions: 0, conversions: 0, totalRevenue: 0 };
    stats[row.variant].totalRevenue += Number(row.total_revenue);
  }

  // Fetch experiment for variant names and auto-stop config
  const expRaw = await env.FOG_KV.get(`experiment:${experimentId}`);
  const experiment: Experiment | null = expRaw ? JSON.parse(expRaw) : null;
  const expVariantNames: string[] = experiment?.variants ?? [];

  const variantKeys = Object.keys(stats).sort((a, b) => Number(a) - Number(b));
  const variantDataForStats = variantKeys.map((v) => ({
    conversions: stats[v].conversions,
    total: stats[v].impressions,
  }));
  const probabilities = multiVariantProbabilities(variantDataForStats);

  const variants = variantKeys.map((v, i) => ({
    index: Number(v),
    name: expVariantNames[Number(v)] ?? `variant ${v}`,
    impressions: stats[v].impressions,
    conversions: stats[v].conversions,
    conversionRate:
      stats[v].impressions > 0 ? stats[v].conversions / stats[v].impressions : 0,
    probability: probabilities[i] ?? null,
    totalRevenue: stats[v].totalRevenue,
    revenuePerVisitor:
      stats[v].impressions > 0 ? stats[v].totalRevenue / stats[v].impressions : 0,
  }));

  // Auto-stopping: evaluate stopping conditions for active experiments/flags
  let finalExp = experiment;
  if (experiment && experiment.status === "active") {
    const expType = experiment.type ?? "experiment";

    if (expType === "experiment" && (experiment.autoStop ?? true)) {
      const updated = await evaluateExperimentStop(env, experiment, variantKeys, stats, probabilities, expVariantNames);
      if (updated) finalExp = updated;
    } else if (expType === "flag") {
      const updated = await evaluateFlagRamp(env, experiment, probabilities);
      if (updated) finalExp = updated;
    }
  }

  return new Response(
    JSON.stringify({
      experimentId,
      variants,
      status: finalExp?.status,
      winner: finalExp?.winner,
      completedAt: finalExp?.completedAt,
    }),
    { status: 200, headers }
  );
}

const RAMP_SCHEDULE = [10, 25, 50, 75, 100];
const FLAG_RAMP_THRESHOLD = 0.95;
const FLAG_CONSECUTIVE_REQUIRED = 3;

async function evaluateExperimentStop(
  env: Env,
  experiment: Experiment,
  variantKeys: string[],
  stats: Record<string, { impressions: number; conversions: number; totalRevenue: number }>,
  probabilities: (number | null)[],
  expVariantNames: string[]
): Promise<Experiment | null> {
  const minSamples = experiment.minSamplesPerVariant ?? 100;

  // All variants must have enough samples
  const allHaveMinSamples = variantKeys.every((v) => stats[v].impressions >= minSamples);
  if (!allHaveMinSamples) return null;

  // Check each treatment variant (index 0 is control)
  for (let i = 1; i < variantKeys.length; i++) {
    const prob = probabilities[i];
    if (prob === null) continue;

    let winner: string | null = null;
    if (prob > 0.99) {
      // Treatment wins
      winner = expVariantNames[Number(variantKeys[i])] ?? `variant ${variantKeys[i]}`;
    } else if (prob < 0.01) {
      // Control wins
      winner = expVariantNames[Number(variantKeys[0])] ?? `variant ${variantKeys[0]}`;
    }

    if (winner !== null) {
      const now = new Date().toISOString();
      const updated: Experiment = {
        ...experiment,
        status: "completed",
        winner,
        completedAt: now,
        updatedAt: now,
      };
      await env.FOG_KV.put(`experiment:${experiment.id}`, JSON.stringify(updated));
      return updated;
    }
  }
  return null;
}

async function evaluateFlagRamp(
  env: Env,
  experiment: Experiment,
  probabilities: (number | null)[]
): Promise<Experiment | null> {
  // Flags are 2-variant: index 0 = off, index 1 = on. P(on > off) is probabilities[1].
  const prob = probabilities[1];
  if (prob === null) return null;

  const autoStopKey = `autostop:${experiment.id}`;

  if (prob > FLAG_RAMP_THRESHOLD) {
    // Increment consecutive-hit count
    const raw = await env.FOG_KV.get(autoStopKey);
    const consecutive = raw ? Number(raw) + 1 : 1;
    await env.FOG_KV.put(autoStopKey, String(consecutive));

    if (consecutive >= FLAG_CONSECUTIVE_REQUIRED) {
      const currentTraffic = experiment.trafficPercent;
      const nextStep = RAMP_SCHEDULE.find((step) => step > currentTraffic);
      if (nextStep !== undefined) {
        const now = new Date().toISOString();
        const updated: Experiment = {
          ...experiment,
          trafficPercent: nextStep,
          updatedAt: now,
        };
        await env.FOG_KV.put(`experiment:${experiment.id}`, JSON.stringify(updated));
        // Reset consecutive counter after ramp
        await env.FOG_KV.put(autoStopKey, "0");
        return updated;
      }
    }
  } else {
    // Reset consecutive counter if threshold not met
    await env.FOG_KV.put(autoStopKey, "0");
  }
  return null;
}
