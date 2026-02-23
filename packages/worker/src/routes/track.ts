import type { Env, TrackPayload, Experiment } from "../types";
import { corsHeaders } from "../lib/cors";
import { writeEvent } from "../lib/analytics";
import { bucket } from "../lib/hash";
import { isBot } from "../lib/bot-detect";
import { generateVisitorId } from "../lib/identity";

export async function handleTrack(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  const headers = {
    ...corsHeaders(origin, false),
  };

  let body: TrackPayload;
  try {
    body = await request.json<TrackPayload>();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  const { experimentId, event } = body;
  if (!event) {
    return new Response(JSON.stringify({ error: "event required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  let variantIndex: number;
  // For pageview events, generate visitorId server-side (no prior /init call)
  const visitorId = event === "pageview"
    ? await generateVisitorId(request, env)
    : body.visitorId;

  if (event === "pageview") {
    // Pageview events are experiment-agnostic: no KV lookup needed
    variantIndex = 0;
  } else {
    if (!body.visitorId || !experimentId) {
      return new Response(JSON.stringify({ error: "visitorId and experimentId required for impression/conversion events" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }
    // Derive variantIndex server-side via deterministic bucketing - never trust client
    const expData = await env.FOG_KV.get(`experiment:${experimentId}`);
    if (!expData) {
      return new Response(JSON.stringify({ error: "Experiment not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }
    const exp: Experiment = JSON.parse(expData);
    variantIndex = bucket(body.visitorId, experimentId, exp.variants.length, exp.trafficPercent);
  }

  // Exclude bot traffic from analytics to prevent stat pollution.
  // Bots still receive normal variant assignments via /init (no cloaking).
  if (!isBot(request)) {
    writeEvent(env, { ...body, visitorId, variantIndex });
  }

  return new Response(null, { status: 204, headers });
}
