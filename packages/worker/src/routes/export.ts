import type { Env } from "../types";
import { corsHeaders } from "../lib/cors";

// Analytics Engine doesn't support parameterized queries - whitelist UUID charset
const SAFE_ID = /^[a-f0-9-]+$/;

interface RawRow {
  experimentId: string;
  variant: string;
  eventType: string;
  eventName: string;
  value: number;
  visitorId: string;
}

interface AEResponse {
  data: RawRow[];
}

export async function handleExport(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const origin = request.headers.get("Origin");
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin, true) };

  const match = pathname.match(/^\/api\/export\/([^/]+)$/);
  const experimentId = match?.[1] ?? "";

  if (!SAFE_ID.test(experimentId)) {
    return new Response(JSON.stringify({ error: "Invalid experiment ID" }), { status: 400, headers });
  }

  const sql = `SELECT blob1 as experimentId, blob2 as variant, blob3 as eventType, blob4 as eventName, double1 as value, index1 as visitorId FROM fog_events WHERE blob1 = '${experimentId}'`;

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
    return new Response(JSON.stringify({ error: `Analytics Engine error: ${res.status}` }), {
      status: 502,
      headers,
    });
  }

  const json = (await res.json()) as AEResponse;
  const rows: RawRow[] = json.data ?? [];

  // Build CSV
  const CSV_HEADERS = "experimentId,variant,eventType,eventName,value,visitorId\n";
  const csvRows = rows.map((r) =>
    [r.experimentId, r.variant, r.eventType, r.eventName ?? "", r.value ?? "", r.visitorId]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = CSV_HEADERS + csvRows.join("\n");

  const timestamp = Date.now();
  const key = `exports/${experimentId}/${timestamp}.csv`;

  await env.FOG_R2.put(key, csv, {
    httpMetadata: { contentType: "text/csv" },
  });

  return new Response(
    JSON.stringify({ key, rows: rows.length, timestamp }),
    { status: 200, headers }
  );
}
