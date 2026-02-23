import type { Env, Experiment, InitResponse } from "../types";
import { generateVisitorId } from "../lib/identity";
import { bucket } from "../lib/hash";
import { corsHeaders } from "../lib/cors";

export async function handleInit(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const visitorId =
    url.searchParams.get("visitorId") ??
    (await generateVisitorId(request, env));

  // Load experiment index (list of IDs)
  const indexJson = await env.FOG_KV.get("experiments:index");
  const ids: string[] = indexJson ? JSON.parse(indexJson) : [];

  // Batch load active experiments
  const experiments: Experiment[] = [];
  await Promise.all(
    ids.map(async (id) => {
      const data = await env.FOG_KV.get(`experiment:${id}`);
      if (data) {
        const exp: Experiment = JSON.parse(data);
        if (exp.status === "active") experiments.push(exp);
      }
    })
  );

  // Compute variant assignment for each active experiment
  const assignments: Record<string, number> = {};
  for (const exp of experiments) {
    const variant = bucket(visitorId, exp.id, exp.variants.length, exp.trafficPercent);
    if (variant >= 0) assignments[exp.id] = variant;
  }

  const body: InitResponse = { visitorId, assignments };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request.headers.get("Origin"), false),
    },
  });
}
