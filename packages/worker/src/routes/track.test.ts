import { describe, it, expect, vi } from "vitest";
import { handleTrack } from "./track";

const BASE = "https://worker.example.com";

function makeEnv(experiment?: Record<string, unknown>) {
  const mockWriteDataPoint = vi.fn();
  return {
    env: {
      FOG_KV: {
        get: vi.fn().mockResolvedValue(experiment ? JSON.stringify(experiment) : null),
        put: vi.fn().mockResolvedValue(undefined),
      },
      FOG_ANALYTICS: {
        writeDataPoint: mockWriteDataPoint,
      },
    } as any,
    mockWriteDataPoint,
  };
}

function makeRequest(body: unknown) {
  return new Request(`${BASE}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validExp = {
  id: "exp-track",
  name: "Track Test",
  variants: ["control", "treatment"],
  trafficPercent: 100,
  status: "active",
  createdAt: "",
  updatedAt: "",
};

describe("handleTrack", () => {
  it("returns 400 for invalid JSON", async () => {
    const { env } = makeEnv(validExp);
    const res = await handleTrack(
      new Request(`${BASE}/track`, { method: "POST", body: "bad-json", headers: { "Content-Type": "application/json" } }),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Invalid JSON/);
  });

  it("returns 400 when required fields missing", async () => {
    const { env } = makeEnv(validExp);
    const res = await handleTrack(makeRequest({ visitorId: "v1" }), env);
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/required/);
  });

  it("returns 400 when visitorId missing", async () => {
    const { env } = makeEnv(validExp);
    const res = await handleTrack(
      makeRequest({ experimentId: "exp-track", event: "impression" }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when experimentId missing", async () => {
    const { env } = makeEnv(validExp);
    const res = await handleTrack(
      makeRequest({ visitorId: "v1", event: "impression" }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown experiment", async () => {
    const { env } = makeEnv(undefined); // KV returns null
    const res = await handleTrack(
      makeRequest({ visitorId: "v1", experimentId: "unknown-exp", event: "impression" }),
      env
    );
    expect(res.status).toBe(404);
    const json = await res.json() as any;
    expect(json.error).toMatch(/not found/i);
  });

  it("writes impression event to analytics engine", async () => {
    const { env, mockWriteDataPoint } = makeEnv(validExp);
    const res = await handleTrack(
      makeRequest({ visitorId: "v1", experimentId: "exp-track", event: "impression" }),
      env
    );
    expect(res.status).toBe(204);
    expect(mockWriteDataPoint).toHaveBeenCalledOnce();
    const call = mockWriteDataPoint.mock.calls[0][0];
    expect(call.blobs[0]).toBe("exp-track");
    expect(call.blobs[2]).toBe("impression");
    expect(call.indexes[0]).toBe("v1");
  });

  it("writes conversion event to analytics engine", async () => {
    const { env, mockWriteDataPoint } = makeEnv(validExp);
    const res = await handleTrack(
      makeRequest({ visitorId: "v2", experimentId: "exp-track", event: "conversion" }),
      env
    );
    expect(res.status).toBe(204);
    const call = mockWriteDataPoint.mock.calls[0][0];
    expect(call.blobs[2]).toBe("conversion");
  });

  it("derives variantIndex server-side via deterministic bucketing", async () => {
    const { env, mockWriteDataPoint } = makeEnv(validExp);
    const visitorId = "bucketing-test-visitor";
    await handleTrack(
      makeRequest({ visitorId, experimentId: "exp-track", event: "impression" }),
      env
    );
    const { bucket } = await import("../lib/hash");
    const expectedVariant = bucket(visitorId, "exp-track", 2, 100);
    const call = mockWriteDataPoint.mock.calls[0][0];
    expect(call.blobs[1]).toBe(String(expectedVariant));
  });

  it("includes optional eventName and value in datapoint", async () => {
    const { env, mockWriteDataPoint } = makeEnv(validExp);
    const res = await handleTrack(
      makeRequest({ visitorId: "v3", experimentId: "exp-track", event: "conversion", eventName: "purchase", value: 42 }),
      env
    );
    expect(res.status).toBe(204);
    const call = mockWriteDataPoint.mock.calls[0][0];
    expect(call.blobs[3]).toBe("purchase");
    expect(call.doubles[0]).toBe(42);
  });

  it("returns open CORS header for SDK track endpoint", async () => {
    const { env } = makeEnv(validExp);
    const req = new Request(`${BASE}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://customer.com" },
      body: JSON.stringify({ visitorId: "v1", experimentId: "exp-track", event: "impression" }),
    });
    const res = await handleTrack(req, env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
