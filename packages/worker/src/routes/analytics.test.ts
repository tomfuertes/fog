import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleAnalytics } from "./analytics";

const BASE = "https://worker.example.com";

function makeEnv() {
  return {
    FOG_KV: { get: vi.fn(), put: vi.fn() },
    FOG_ANALYTICS: { writeDataPoint: vi.fn() },
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
  } as any;
}

function makeAEResponse(rows: unknown[]) {
  return new Response(JSON.stringify({ data: rows }), { status: 200 });
}

describe("handleAnalytics", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns 400 for invalid period", async () => {
    const env = makeEnv();
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics?period=invalid`),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Invalid period/);
  });

  it("returns 400 for page filter with SQL-injection characters", async () => {
    const env = makeEnv();
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics?page=' OR '1'='1`),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Invalid page filter/);
  });

  it("returns 200 with default 7d period and empty AE data", async () => {
    const env = makeEnv();
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([]))  // timeseries
      .mockResolvedValueOnce(makeAEResponse([]))  // top pages
      .mockResolvedValueOnce(makeAEResponse([])); // summary
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics`),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.period).toBe("7d");
    expect(json.totalViews).toBe(0);
    expect(json.uniqueVisitors).toBe(0);
    expect(json.timeseries).toEqual([]);
    expect(json.topPages).toEqual([]);
  });

  it("returns 200 with today period", async () => {
    const env = makeEnv();
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]));
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics?period=today`),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.period).toBe("today");
  });

  it("returns 200 with 30d period", async () => {
    const env = makeEnv();
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]));
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics?period=30d`),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.period).toBe("30d");
  });

  it("returns populated timeseries and topPages from AE data", async () => {
    const env = makeEnv();
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([
        { date_bucket: "2026-02-15 00:00:00", views: 42 },
        { date_bucket: "2026-02-16 00:00:00", views: 55 },
      ]))
      .mockResolvedValueOnce(makeAEResponse([
        { page: "/home", views: 60, unique_visitors: 45 },
        { page: "/about", views: 37, unique_visitors: 30 },
      ]))
      .mockResolvedValueOnce(makeAEResponse([
        { total_views: 97, unique_visitors: 75 },
      ]));
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics?period=7d`),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.totalViews).toBe(97);
    expect(json.uniqueVisitors).toBe(75);
    expect(json.timeseries).toHaveLength(2);
    expect(json.timeseries[0]).toEqual({ bucket: "2026-02-15 00:00:00", views: 42 });
    expect(json.timeseries[1]).toEqual({ bucket: "2026-02-16 00:00:00", views: 55 });
    expect(json.topPages).toHaveLength(2);
    expect(json.topPages[0]).toEqual({ page: "/home", views: 60, uniqueVisitors: 45 });
    expect(json.topPages[1]).toEqual({ page: "/about", views: 37, uniqueVisitors: 30 });
  });

  it("returns 502 when Analytics Engine fetch fails", async () => {
    const env = makeEnv();
    fetchSpy.mockResolvedValue(new Response("error", { status: 500 }));
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics`),
      env
    );
    expect(res.status).toBe(502);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Analytics Engine/);
  });

  it("returns 502 when fetch throws a network error", async () => {
    const env = makeEnv();
    fetchSpy.mockRejectedValue(new Error("Network error"));
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics`),
      env
    );
    expect(res.status).toBe(502);
  });

  it("accepts a valid page filter and includes it in query", async () => {
    const env = makeEnv();
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]));
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics?page=/about`),
      env
    );
    expect(res.status).toBe(200);
    // Verify the page filter was passed to AE (check the SQL sent)
    const calls = fetchSpy.mock.calls;
    const firstBody = calls[0][1]?.body as string;
    expect(firstBody).toContain("/about");
  });

  it("admin CORS does not reflect origin", async () => {
    const env = makeEnv();
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]))
      .mockResolvedValueOnce(makeAEResponse([]));
    const res = await handleAnalytics(
      new Request(`${BASE}/api/analytics`, { headers: { Origin: "https://attacker.com" } }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
