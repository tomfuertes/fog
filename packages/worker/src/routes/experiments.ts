import type { Env, Experiment } from "../types";
import { corsHeaders } from "../lib/cors";

function idFromPath(pathname: string): string | null {
  // Matches /api/experiments/<id>
  const match = pathname.match(/^\/api\/experiments\/([^/]+)$/);
  return match ? match[1] : null;
}

function jsonResponse(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, true),
    },
  });
}

async function getIndex(env: Env): Promise<string[]> {
  const raw = await env.FOG_KV.get("experiments:index");
  return raw ? JSON.parse(raw) : [];
}

async function setIndex(env: Env, ids: string[]): Promise<void> {
  await env.FOG_KV.put("experiments:index", JSON.stringify(ids));
}

export async function handleExperiments(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;
  const origin = request.headers.get("Origin");
  const id = idFromPath(pathname);

  // GET /api/experiments - list all
  if (method === "GET" && !id) {
    const ids = await getIndex(env);
    const experiments = (
      await Promise.all(ids.map((i) => env.FOG_KV.get(`experiment:${i}`)))
    )
      .filter(Boolean)
      .map((raw) => JSON.parse(raw!));
    return jsonResponse(experiments, 200, origin);
  }

  // POST /api/experiments - create
  if (method === "POST" && !id) {
    let body: Partial<Experiment>;
    try {
      body = await request.json<Partial<Experiment>>();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, origin);
    }
    if (!body.name) {
      return jsonResponse({ error: "name required" }, 400, origin);
    }
    const variants = body.variants ?? ["control", "treatment"];
    if (variants.length < 2) {
      return jsonResponse({ error: "variants must have at least 2 entries" }, 400, origin);
    }
    const trafficPercent = body.trafficPercent ?? 100;
    if (typeof trafficPercent !== "number" || trafficPercent < 0 || trafficPercent > 100) {
      return jsonResponse({ error: "trafficPercent must be a number between 0 and 100" }, 400, origin);
    }
    const now = new Date().toISOString();
    const experiment: Experiment = {
      id: crypto.randomUUID(),
      name: body.name,
      variants,
      trafficPercent,
      status: body.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };
    await env.FOG_KV.put(`experiment:${experiment.id}`, JSON.stringify(experiment));
    const ids = await getIndex(env);
    await setIndex(env, [...ids, experiment.id]);
    return jsonResponse(experiment, 201, origin);
  }

  // GET /api/experiments/:id
  if (method === "GET" && id) {
    const raw = await env.FOG_KV.get(`experiment:${id}`);
    if (!raw) return jsonResponse({ error: "Not found" }, 404, origin);
    return jsonResponse(JSON.parse(raw), 200, origin);
  }

  // PUT or PATCH /api/experiments/:id - update (merge fields)
  if ((method === "PUT" || method === "PATCH") && id) {
    const raw = await env.FOG_KV.get(`experiment:${id}`);
    if (!raw) return jsonResponse({ error: "Not found" }, 404, origin);
    let body: Partial<Experiment>;
    try {
      body = await request.json<Partial<Experiment>>();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, origin);
    }
    // Disallow variant changes on PATCH/PUT - variant mutation after data collection
    // would corrupt bucketing and invalidate historical assignments.
    if (body.variants !== undefined) {
      return jsonResponse({ error: "variants cannot be changed after experiment creation" }, 400, origin);
    }
    if (body.trafficPercent !== undefined) {
      if (typeof body.trafficPercent !== "number" || body.trafficPercent < 0 || body.trafficPercent > 100) {
        return jsonResponse({ error: "trafficPercent must be a number between 0 and 100" }, 400, origin);
      }
    }
    const existing: Experiment = JSON.parse(raw);
    const updated: Experiment = {
      ...existing,
      ...body,
      id: existing.id, // immutable
      createdAt: existing.createdAt, // immutable
      updatedAt: new Date().toISOString(),
    };
    await env.FOG_KV.put(`experiment:${id}`, JSON.stringify(updated));
    return jsonResponse(updated, 200, origin);
  }

  // DELETE /api/experiments/:id
  if (method === "DELETE" && id) {
    await env.FOG_KV.delete(`experiment:${id}`);
    const ids = await getIndex(env);
    await setIndex(env, ids.filter((i) => i !== id));
    return jsonResponse({ deleted: id }, 200, origin);
  }

  return jsonResponse({ error: "Method not allowed" }, 405, origin);
}
