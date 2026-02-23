import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleResults } from "./results";

const BASE = "https://worker.example.com";

function makeEnv(fetchImpl?: typeof fetch, kvData: Record<string, string | null> = {}) {
  return {
    env: {
      FOG_KV: {
        get: vi.fn().mockImplementation((key: string) => Promise.resolve(kvData[key] ?? null)),
        put: vi.fn().mockResolvedValue(undefined),
      },
      FOG_ANALYTICS: { writeDataPoint: vi.fn() },
      CF_API_TOKEN: "test-token",
      CF_ACCOUNT_ID: "test-account",
    } as any,
    fetchImpl,
  };
}

function makeAEResponse(rows: unknown[]) {
  return new Response(JSON.stringify({ data: rows }), { status: 200 });
}

describe("handleResults", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns 400 for experiment ID with invalid characters (SQL injection guard)", async () => {
    const { env } = makeEnv();
    const res = await handleResults(
      new Request(`${BASE}/api/results/'; DROP TABLE--`),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Invalid experiment ID/);
  });

  it("returns 400 for experiment ID with uppercase letters", async () => {
    const { env } = makeEnv();
    const res = await handleResults(
      new Request(`${BASE}/api/results/UPPERCASE-ID`),
      env
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty experiment ID path", async () => {
    const { env } = makeEnv();
    const res = await handleResults(
      new Request(`${BASE}/api/results/`),
      env
    );
    expect(res.status).toBe(400);
  });

  it("accepts valid UUID-format experiment ID", async () => {
    const validId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    fetchSpy.mockResolvedValueOnce(makeAEResponse([])).mockResolvedValueOnce(makeAEResponse([]));
    const { env } = makeEnv();
    const res = await handleResults(
      new Request(`${BASE}/api/results/${validId}`),
      env
    );
    expect(res.status).toBe(200);
  });

  it("returns 502 when Analytics Engine fetch fails", async () => {
    fetchSpy.mockResolvedValue(new Response("error", { status: 500 }));
    const { env } = makeEnv();
    const res = await handleResults(
      new Request(`${BASE}/api/results/abc123`),
      env
    );
    expect(res.status).toBe(502);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Analytics Engine/);
  });

  it("returns 502 when fetch throws (missing CF_API_TOKEN equivalent)", async () => {
    fetchSpy.mockRejectedValue(new Error("Network error"));
    const { env } = makeEnv();
    const res = await handleResults(
      new Request(`${BASE}/api/results/abc123`),
      env
    );
    expect(res.status).toBe(502);
  });

  it("returns probability and variant stats from AE data", async () => {
    const expId = "aabbccddeeff";
    const expData = {
      id: expId,
      name: "Results Test",
      variants: ["control", "treatment"],
      trafficPercent: 100,
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([
        { variant: "0", eventType: "impression", count: 100 },
        { variant: "0", eventType: "conversion", count: 10 },
        { variant: "1", eventType: "impression", count: 100 },
        { variant: "1", eventType: "conversion", count: 20 },
      ]))
      .mockResolvedValueOnce(makeAEResponse([])); // no revenue data
    const { env } = makeEnv(undefined, { [`experiment:${expId}`]: JSON.stringify(expData) });
    const res = await handleResults(
      new Request(`${BASE}/api/results/${expId}`),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.experimentId).toBe(expId);
    expect(json.variants).toHaveLength(2);
    const control = json.variants.find((v: any) => v.index === 0);
    const treatment = json.variants.find((v: any) => v.index === 1);
    expect(control.impressions).toBe(100);
    expect(control.conversions).toBe(10);
    expect(control.conversionRate).toBeCloseTo(0.1);
    expect(treatment.conversions).toBe(20);
    // Treatment has 2x conversion rate so per-variant probability > 0.5
    expect(treatment.probability).toBeGreaterThan(0.5);
    expect(control.probability).toBeNull();
    // No revenue data - defaults to 0
    expect(control.totalRevenue).toBe(0);
    expect(control.revenuePerVisitor).toBe(0);
  });

  it("returns revenue metrics when revenue data exists", async () => {
    const expId = "aabbccddeeff";
    const expData = {
      id: expId,
      name: "Revenue Test",
      variants: ["control", "treatment"],
      trafficPercent: 100,
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([
        { variant: "0", eventType: "impression", count: 100 },
        { variant: "1", eventType: "impression", count: 100 },
      ]))
      .mockResolvedValueOnce(makeAEResponse([
        { variant: "0", total_revenue: 500 },
        { variant: "1", total_revenue: 800 },
      ]));
    const { env } = makeEnv(undefined, { [`experiment:${expId}`]: JSON.stringify(expData) });
    const res = await handleResults(
      new Request(`${BASE}/api/results/${expId}`),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    const control = json.variants.find((v: any) => v.index === 0);
    const treatment = json.variants.find((v: any) => v.index === 1);
    expect(control.totalRevenue).toBe(500);
    expect(control.revenuePerVisitor).toBeCloseTo(5);
    expect(treatment.totalRevenue).toBe(800);
    expect(treatment.revenuePerVisitor).toBeCloseTo(8);
  });

  it("returns zero revenuePerVisitor when no impressions exist for a revenue-only variant", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([])) // no impression/conversion rows
      .mockResolvedValueOnce(makeAEResponse([
        { variant: "0", total_revenue: 100 },
      ]));
    const { env } = makeEnv(undefined, {});
    const res = await handleResults(
      new Request(`${BASE}/api/results/abc123`),
      env
    );
    const json = await res.json() as any;
    const v = json.variants.find((v: any) => v.index === 0);
    expect(v.totalRevenue).toBe(100);
    expect(v.revenuePerVisitor).toBe(0);
  });

  it("uses fallback variant name when experiment not found in KV", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeAEResponse([
        { variant: "0", eventType: "impression", count: 50 },
      ]))
      .mockResolvedValueOnce(makeAEResponse([]));
    const { env } = makeEnv(undefined, {}); // no KV data
    const res = await handleResults(
      new Request(`${BASE}/api/results/abc123`),
      env
    );
    const json = await res.json() as any;
    expect(json.variants[0].name).toMatch(/variant 0/);
  });

  it("admin CORS does not reflect origin", async () => {
    fetchSpy.mockResolvedValueOnce(makeAEResponse([])).mockResolvedValueOnce(makeAEResponse([]));
    const { env } = makeEnv();
    const res = await handleResults(
      new Request(`${BASE}/api/results/abc123`, { headers: { Origin: "https://attacker.com" } }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  describe("auto-stopping (experiments)", () => {
    function makeExperiment(overrides: Record<string, unknown> = {}) {
      return {
        id: "aabbccddeeff",
        name: "Stop Test",
        variants: ["control", "treatment"],
        trafficPercent: 100,
        status: "active",
        type: "experiment",
        createdAt: "",
        updatedAt: "",
        minSamplesPerVariant: 100,
        autoStop: true,
        ...overrides,
      };
    }

    it("stops experiment and records winner when treatment probability > 0.99", async () => {
      const expId = "aabbccddeeff";
      const exp = makeExperiment();
      // High sample counts ensure we clear minSamples; mock AE returns strong signal for treatment
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 1000 },
          { variant: "0", eventType: "conversion", count: 10 },
          { variant: "1", eventType: "impression", count: 1000 },
          { variant: "1", eventType: "conversion", count: 900 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([])); // no revenue
      const kvData: Record<string, string | null> = { [`experiment:${expId}`]: JSON.stringify(exp) };
      const { env } = makeEnv(undefined, kvData);

      // Capture KV puts to verify winner written
      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );

      const res = await handleResults(new Request(`${BASE}/api/results/${expId}`), env);
      expect(res.status).toBe(200);
      const json = await res.json() as any;

      // Response should reflect completed status (returned directly from stop helper)
      expect(json.status).toBe("completed");
      expect(json.winner).toBe("treatment");
      expect(json.completedAt).toBeDefined();

      // KV should have been updated with completed experiment
      const expPut = putCalls.find(([k]: [string, string]) => k === `experiment:${expId}`);
      expect(expPut).toBeDefined();
      const saved = JSON.parse(expPut![1]);
      expect(saved.status).toBe("completed");
      expect(saved.winner).toBe("treatment");
    });

    it("stops experiment and names control as winner when treatment probability < 0.01", async () => {
      const expId = "aabbccddeeff";
      const exp = makeExperiment();
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 1000 },
          { variant: "0", eventType: "conversion", count: 900 },
          { variant: "1", eventType: "impression", count: 1000 },
          { variant: "1", eventType: "conversion", count: 10 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([]));
      const kvData: Record<string, string | null> = { [`experiment:${expId}`]: JSON.stringify(exp) };
      const { env } = makeEnv(undefined, kvData);

      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );

      const res = await handleResults(new Request(`${BASE}/api/results/${expId}`), env);
      const json = await res.json() as any;
      expect(json.status).toBe("completed");
      expect(json.winner).toBe("control");
    });

    it("does not stop experiment when minSamplesPerVariant not reached", async () => {
      const expId = "aabbccddeeff";
      const exp = makeExperiment({ minSamplesPerVariant: 200 });
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 100 }, // under 200
          { variant: "0", eventType: "conversion", count: 5 },
          { variant: "1", eventType: "impression", count: 100 },
          { variant: "1", eventType: "conversion", count: 90 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([]));
      const kvData: Record<string, string | null> = { [`experiment:${expId}`]: JSON.stringify(exp) };
      const { env } = makeEnv(undefined, kvData);

      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );
      (env.FOG_KV.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
        Promise.resolve(kvData[key] ?? null)
      );

      const res = await handleResults(new Request(`${BASE}/api/results/${expId}`), env);
      const json = await res.json() as any;
      // Status comes from unchanged experiment
      expect(json.status).toBe("active");
      // No KV put on experiment key
      const expPuts = putCalls.filter(([k]: [string, string]) => k === `experiment:${expId}`);
      expect(expPuts).toHaveLength(0);
    });

    it("does not stop an already-completed experiment", async () => {
      const expId = "aabbccddeeff";
      const exp = makeExperiment({ status: "completed", winner: "treatment" });
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 1000 },
          { variant: "0", eventType: "conversion", count: 10 },
          { variant: "1", eventType: "impression", count: 1000 },
          { variant: "1", eventType: "conversion", count: 900 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([]));
      const kvData: Record<string, string | null> = { [`experiment:${expId}`]: JSON.stringify(exp) };
      const { env } = makeEnv(undefined, kvData);

      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );
      (env.FOG_KV.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
        Promise.resolve(kvData[key] ?? null)
      );

      await handleResults(new Request(`${BASE}/api/results/${expId}`), env);
      // No new KV writes should happen for completed experiment
      const expPuts = putCalls.filter(([k]: [string, string]) => k === `experiment:${expId}`);
      expect(expPuts).toHaveLength(0);
    });

    it("skips auto-stop when autoStop is false", async () => {
      const expId = "aabbccddeeff";
      const exp = makeExperiment({ autoStop: false });
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 1000 },
          { variant: "0", eventType: "conversion", count: 10 },
          { variant: "1", eventType: "impression", count: 1000 },
          { variant: "1", eventType: "conversion", count: 900 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([]));
      const kvData: Record<string, string | null> = { [`experiment:${expId}`]: JSON.stringify(exp) };
      const { env } = makeEnv(undefined, kvData);

      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );
      (env.FOG_KV.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
        Promise.resolve(kvData[key] ?? null)
      );

      const res = await handleResults(new Request(`${BASE}/api/results/${expId}`), env);
      const json = await res.json() as any;
      expect(json.status).toBe("active");
    });
  });

  describe("auto-ramp (flags)", () => {
    function makeFlag(trafficPercent = 10, overrides: Record<string, unknown> = {}) {
      return {
        id: "f1a9f1a9f1a9",
        name: "Flag Test",
        variants: ["off", "on"],
        trafficPercent,
        status: "active",
        type: "flag",
        createdAt: "",
        updatedAt: "",
        ...overrides,
      };
    }

    it("increments consecutive counter when P(on>off) > 0.95 but does not ramp yet", async () => {
      const expId = "f1a9f1a9f1a9";
      const exp = makeFlag(10);
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 1000 },
          { variant: "0", eventType: "conversion", count: 100 },
          { variant: "1", eventType: "impression", count: 1000 },
          { variant: "1", eventType: "conversion", count: 800 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([]));
      const kvData: Record<string, string | null> = {
        [`experiment:${expId}`]: JSON.stringify(exp),
        [`autostop:${expId}`]: null,
      };
      const { env } = makeEnv(undefined, kvData);

      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );
      (env.FOG_KV.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
        Promise.resolve(kvData[key] ?? null)
      );

      await handleResults(new Request(`${BASE}/api/results/${expId}`), env);

      // autostop key should be incremented to 1
      const counterPut = putCalls.find(([k]: [string, string]) => k === `autostop:${expId}`);
      expect(counterPut).toBeDefined();
      expect(counterPut![1]).toBe("1");
      // No ramp yet (< 3 consecutive hits)
      const expPuts = putCalls.filter(([k]: [string, string]) => k === `experiment:${expId}`);
      expect(expPuts).toHaveLength(0);
    });

    it("ramps trafficPercent after 3 consecutive checks above threshold", async () => {
      const expId = "f1a9f1a9f1a9";
      const exp = makeFlag(10);
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 1000 },
          { variant: "0", eventType: "conversion", count: 100 },
          { variant: "1", eventType: "impression", count: 1000 },
          { variant: "1", eventType: "conversion", count: 800 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([]));
      const kvData: Record<string, string | null> = {
        [`experiment:${expId}`]: JSON.stringify(exp),
        [`autostop:${expId}`]: "2", // 2 previous hits, this one makes 3
      };
      const { env } = makeEnv(undefined, kvData);

      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );
      (env.FOG_KV.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
        Promise.resolve(kvData[key] ?? null)
      );

      await handleResults(new Request(`${BASE}/api/results/${expId}`), env);

      // Experiment should be ramped to 25 (next step after 10)
      const expPut = putCalls.find(([k]: [string, string]) => k === `experiment:${expId}`);
      expect(expPut).toBeDefined();
      const saved = JSON.parse(expPut![1]);
      expect(saved.trafficPercent).toBe(25);

      // Counter should be reset to 0
      const counterPuts = putCalls.filter(([k]: [string, string]) => k === `autostop:${expId}`);
      expect(counterPuts[counterPuts.length - 1][1]).toBe("0");
    });

    it("resets counter when P(on>off) drops below threshold", async () => {
      const expId = "f1a9f1a9f1a9";
      const exp = makeFlag(25);
      fetchSpy
        .mockResolvedValueOnce(makeAEResponse([
          { variant: "0", eventType: "impression", count: 1000 },
          { variant: "0", eventType: "conversion", count: 700 },
          { variant: "1", eventType: "impression", count: 1000 },
          { variant: "1", eventType: "conversion", count: 300 },
        ]))
        .mockResolvedValueOnce(makeAEResponse([]));
      const kvData: Record<string, string | null> = {
        [`experiment:${expId}`]: JSON.stringify(exp),
        [`autostop:${expId}`]: "2", // had 2 previous hits
      };
      const { env } = makeEnv(undefined, kvData);

      const putCalls: Array<[string, string]> = [];
      (env.FOG_KV.put as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string, val: string) => { putCalls.push([key, val]); return Promise.resolve(); }
      );
      (env.FOG_KV.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
        Promise.resolve(kvData[key] ?? null)
      );

      await handleResults(new Request(`${BASE}/api/results/${expId}`), env);

      // Counter should be reset to 0
      const counterPuts = putCalls.filter(([k]: [string, string]) => k === `autostop:${expId}`);
      expect(counterPuts.length).toBeGreaterThan(0);
      expect(counterPuts[counterPuts.length - 1][1]).toBe("0");
      // No ramp
      const expPuts = putCalls.filter(([k]: [string, string]) => k === `experiment:${expId}`);
      expect(expPuts).toHaveLength(0);
    });
  });
});
