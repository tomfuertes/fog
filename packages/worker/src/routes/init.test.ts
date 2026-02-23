import { describe, it, expect, vi } from "vitest";

// Mock identity so tests don't need real HMAC
vi.mock("../lib/identity", () => ({
  generateVisitorId: vi.fn().mockResolvedValue("visitor-test-id"),
}));

import { handleInit } from "./init";
import { bucket } from "../lib/hash";

const BASE = "https://worker.example.com";

function makeEnv(experiments: Record<string, unknown>[] = [], kvExtra: Record<string, string | null> = {}) {
  const kvStore: Record<string, string | null> = {
    "experiments:index": JSON.stringify(experiments.map((e: any) => e.id)),
    ...Object.fromEntries(experiments.map((e: any) => [`experiment:${e.id}`, JSON.stringify(e)])),
    ...kvExtra,
  };
  return {
    FOG_KV: {
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(kvStore[key] ?? null)),
      put: vi.fn().mockResolvedValue(undefined),
    },
    FOG_ANALYTICS: { writeDataPoint: vi.fn() },
  } as any;
}

function activeExp(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Test Exp",
    variants: ["control", "treatment"],
    trafficPercent: 100,
    status: "active",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("handleInit", () => {
  it("returns visitorId and empty assignments when no experiments exist", async () => {
    const env = makeEnv([]);
    const res = await handleInit(new Request(`${BASE}/init`), env);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.visitorId).toBe("visitor-test-id");
    expect(json.assignments).toEqual({});
  });

  it("assigns variant for active experiment", async () => {
    const exp = activeExp("exp-a");
    const env = makeEnv([exp]);
    const res = await handleInit(new Request(`${BASE}/init`), env);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    const expectedVariant = bucket("visitor-test-id", "exp-a", 2, 100);
    expect(json.assignments["exp-a"]).toBe(expectedVariant);
  });

  it("skips paused experiments", async () => {
    const exp = activeExp("exp-paused", { status: "paused" });
    const env = makeEnv([exp]);
    const res = await handleInit(new Request(`${BASE}/init`), env);
    const json = await res.json() as any;
    expect(json.assignments["exp-paused"]).toBeUndefined();
  });

  it("omits experiment when visitor is outside traffic sample", async () => {
    // trafficPercent=0 means no visitor is included
    const exp = activeExp("exp-zero", { trafficPercent: 0 });
    const env = makeEnv([exp]);
    const res = await handleInit(new Request(`${BASE}/init`), env);
    const json = await res.json() as any;
    expect(json.assignments["exp-zero"]).toBeUndefined();
  });

  it("respects visitorId query param over generated identity", async () => {
    const exp = activeExp("exp-b");
    const env = makeEnv([exp]);
    const customId = "custom-visitor-xyz";
    const res = await handleInit(new Request(`${BASE}/init?visitorId=${customId}`), env);
    const json = await res.json() as any;
    expect(json.visitorId).toBe(customId);
    const expectedVariant = bucket(customId, "exp-b", 2, 100);
    expect(json.assignments["exp-b"]).toBe(expectedVariant);
  });

  it("bucketing is consistent - same visitorId + experimentId always same variant", async () => {
    const exp = activeExp("exp-c");
    const env = makeEnv([exp]);
    const visitorId = "stable-visitor-1";
    const req1 = new Request(`${BASE}/init?visitorId=${visitorId}`);
    const req2 = new Request(`${BASE}/init?visitorId=${visitorId}`);
    const [r1, r2] = await Promise.all([handleInit(req1, env), handleInit(req2, env)]);
    const [j1, j2] = await Promise.all([r1.json() as any, r2.json() as any]);
    expect(j1.assignments["exp-c"]).toBe(j2.assignments["exp-c"]);
  });

  it("assigns across multiple active experiments", async () => {
    const exp1 = activeExp("multi-1");
    const exp2 = activeExp("multi-2");
    const env = makeEnv([exp1, exp2]);
    const res = await handleInit(new Request(`${BASE}/init?visitorId=v1`), env);
    const json = await res.json() as any;
    expect(json.assignments).toHaveProperty("multi-1");
    expect(json.assignments).toHaveProperty("multi-2");
  });

  it("returns open CORS header for SDK endpoint", async () => {
    const env = makeEnv([]);
    const req = new Request(`${BASE}/init`, { headers: { Origin: "https://customer.com" } });
    const res = await handleInit(req, env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
