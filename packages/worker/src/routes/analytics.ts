import type { Env } from "../types";
import { corsHeaders } from "../lib/cors";

// Analytics Engine doesn't support parameterized queries - only allow safe period values
const VALID_PERIODS = new Set(["today", "7d", "30d"]);

// Safe page filter: restrict to printable ASCII, no SQL special chars
const SAFE_PAGE = /^[a-zA-Z0-9/_\-%.~]*$/;

interface AEPageviewRow {
  date_bucket: string;
  views: number;
}

interface AETopPageRow {
  page: string;
  views: number;
  unique_visitors: number;
}

interface AESummaryRow {
  total_views: number;
  unique_visitors: number;
}

interface AEResponse<T> {
  data: T[];
}

async function queryAE<T>(env: Env, sql: string): Promise<T[]> {
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

// Returns an interval string safe for interpolation based on validated period
function periodToInterval(period: string): string {
  if (period === "today") return "1 DAY";
  if (period === "7d") return "7 DAY";
  return "30 DAY"; // 30d - already validated against VALID_PERIODS
}

// Returns the GROUP BY truncation unit for time-series bucketing
function periodToTrunc(period: string): string {
  if (period === "today") return "toStartOfHour";
  return "toStartOfDay";
}

export async function handleAnalytics(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("Origin");
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin, true) };

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "7d";
  const pageFilter = url.searchParams.get("page") ?? "";

  if (!VALID_PERIODS.has(period)) {
    return new Response(JSON.stringify({ error: "Invalid period. Use: today, 7d, 30d" }), {
      status: 400,
      headers,
    });
  }

  if (pageFilter && !SAFE_PAGE.test(pageFilter)) {
    return new Response(JSON.stringify({ error: "Invalid page filter" }), {
      status: 400,
      headers,
    });
  }

  const interval = periodToInterval(period);
  const trunc = periodToTrunc(period);
  // blob3 = eventType ('pageview'), blob4 = eventName (URL/path)
  // blob1 = '' for analytics-only events, index1 = visitorId
  const pageClause = pageFilter ? `AND blob4 = '${pageFilter}'` : "";
  const baseWhere = `blob3 = 'pageview' ${pageClause}AND timestamp >= NOW() - INTERVAL '${interval}'`;

  let timeseriesRows: AEPageviewRow[];
  let topPageRows: AETopPageRow[];
  let summaryRows: AESummaryRow[];

  try {
    [timeseriesRows, topPageRows, summaryRows] = await Promise.all([
      // Time-series: pageviews per hour (today) or per day (7d/30d)
      queryAE<AEPageviewRow>(
        env,
        `SELECT ${trunc}(timestamp) AS date_bucket, count() AS views FROM fog_events WHERE ${baseWhere} GROUP BY date_bucket ORDER BY date_bucket ASC`
      ),
      // Top pages by view count + unique visitors
      queryAE<AETopPageRow>(
        env,
        `SELECT blob4 AS page, count() AS views, count(DISTINCT index1) AS unique_visitors FROM fog_events WHERE ${baseWhere} GROUP BY page ORDER BY views DESC LIMIT 20`
      ),
      // Summary totals
      queryAE<AESummaryRow>(
        env,
        `SELECT count() AS total_views, count(DISTINCT index1) AS unique_visitors FROM fog_events WHERE ${baseWhere}`
      ),
    ]);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers });
  }

  const summary = summaryRows[0] ?? { total_views: 0, unique_visitors: 0 };

  return new Response(
    JSON.stringify({
      period,
      totalViews: Number(summary.total_views),
      uniqueVisitors: Number(summary.unique_visitors),
      timeseries: timeseriesRows.map((r) => ({
        bucket: r.date_bucket,
        views: Number(r.views),
      })),
      topPages: topPageRows.map((r) => ({
        page: r.page,
        views: Number(r.views),
        uniqueVisitors: Number(r.unique_visitors),
      })),
    }),
    { status: 200, headers }
  );
}
