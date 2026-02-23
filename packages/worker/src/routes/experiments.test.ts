import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleExperiments } from "./experiments";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    FOG_KV: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as any;
}

function makeRequest(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const BASE = "https://worker.example.com";

describe("GET /api/experiments - list", () => {
  it("returns empty array when no experiments exist", async () => {
    const env = makeEnv();
    const res = await handleExperiments(makeRequest("GET", `${BASE}/api/experiments`), env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it("returns all stored experiments", async () => {
    const exp = { id: "abc", name: "Test", variants: ["a", "b"], trafficPercent: 100, status: "active", createdAt: "", updatedAt: "" };
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockImplementation((key: string) => {
          if (key === "experiments:index") return Promise.resolve(JSON.stringify(["abc"]));
          if (key === "experiment:abc") return Promise.resolve(JSON.stringify(exp));
          return Promise.resolve(null);
        }),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(makeRequest("GET", `${BASE}/api/experiments`), env);
    expect(res.status).toBe(200);
    const json = await res.json() as any[];
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe("Test");
  });
});

describe("POST /api/experiments - create", () => {
  it("creates experiment with defaults", async () => {
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(
      makeRequest("POST", `${BASE}/api/experiments`, { name: "My Experiment" }),
      env
    );
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.name).toBe("My Experiment");
    expect(json.variants).toEqual(["control", "treatment"]);
    expect(json.trafficPercent).toBe(100);
    expect(json.status).toBe("active");
    expect(json.id).toBeTruthy();
  });

  it("rejects missing name", async () => {
    const env = makeEnv();
    const res = await handleExperiments(
      makeRequest("POST", `${BASE}/api/experiments`, { variants: ["a", "b"] }),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/name/);
  });

  it("rejects fewer than 2 variants", async () => {
    const env = makeEnv();
    const res = await handleExperiments(
      makeRequest("POST", `${BASE}/api/experiments`, { name: "x", variants: ["only"] }),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/variants/);
  });

  it("rejects trafficPercent > 100", async () => {
    const env = makeEnv();
    const res = await handleExperiments(
      makeRequest("POST", `${BASE}/api/experiments`, { name: "x", trafficPercent: 101 }),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/trafficPercent/);
  });

  it("rejects trafficPercent < 0", async () => {
    const env = makeEnv();
    const res = await handleExperiments(
      makeRequest("POST", `${BASE}/api/experiments`, { name: "x", trafficPercent: -1 }),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/trafficPercent/);
  });

  it("accepts trafficPercent = 0", async () => {
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(
      makeRequest("POST", `${BASE}/api/experiments`, { name: "x", trafficPercent: 0 }),
      env
    );
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.trafficPercent).toBe(0);
  });

  it("rejects invalid JSON body", async () => {
    const env = makeEnv();
    const res = await handleExperiments(
      new Request(`${BASE}/api/experiments`, { method: "POST", body: "not-json", headers: { "Content-Type": "application/json" } }),
      env
    );
    expect(res.status).toBe(400);
  });

  it("admin CORS does not reflect origin", async () => {
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const req = new Request(`${BASE}/api/experiments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.com" },
      body: JSON.stringify({ name: "x" }),
    });
    const res = await handleExperiments(req, env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("GET /api/experiments/:id", () => {
  it("returns 404 when experiment not found", async () => {
    const env = makeEnv();
    const res = await handleExperiments(makeRequest("GET", `${BASE}/api/experiments/missing-id`), env);
    expect(res.status).toBe(404);
  });

  it("returns experiment when found", async () => {
    const exp = { id: "test-id", name: "Found", variants: ["a", "b"], trafficPercent: 50, status: "active", createdAt: "", updatedAt: "" };
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(exp)),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(makeRequest("GET", `${BASE}/api/experiments/test-id`), env);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.name).toBe("Found");
  });
});

describe("PATCH /api/experiments/:id - update", () => {
  it("pauses an active experiment", async () => {
    const exp = { id: "exp-1", name: "Pausing", variants: ["a", "b"], trafficPercent: 100, status: "active", createdAt: "t", updatedAt: "t" };
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(exp)),
        put: mockPut,
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(
      makeRequest("PATCH", `${BASE}/api/experiments/exp-1`, { status: "paused" }),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe("paused");
    expect(json.id).toBe("exp-1"); // id immutable
    expect(json.createdAt).toBe("t"); // createdAt immutable
  });

  it("resumes a paused experiment", async () => {
    const exp = { id: "exp-2", name: "Resuming", variants: ["a", "b"], trafficPercent: 100, status: "paused", createdAt: "t", updatedAt: "t" };
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(exp)),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(
      makeRequest("PATCH", `${BASE}/api/experiments/exp-2`, { status: "active" }),
      env
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe("active");
  });

  it("blocks variant mutation after creation", async () => {
    const exp = { id: "exp-3", name: "Test", variants: ["a", "b"], trafficPercent: 100, status: "active", createdAt: "t", updatedAt: "t" };
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(exp)),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(
      makeRequest("PATCH", `${BASE}/api/experiments/exp-3`, { variants: ["x", "y", "z"] }),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/variants/);
  });

  it("validates trafficPercent on PATCH", async () => {
    const exp = { id: "exp-4", name: "Test", variants: ["a", "b"], trafficPercent: 100, status: "active", createdAt: "t", updatedAt: "t" };
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(exp)),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    });
    const res = await handleExperiments(
      makeRequest("PATCH", `${BASE}/api/experiments/exp-4`, { trafficPercent: 150 }),
      env
    );
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/trafficPercent/);
  });

  it("returns 404 for unknown experiment", async () => {
    const env = makeEnv();
    const res = await handleExperiments(
      makeRequest("PATCH", `${BASE}/api/experiments/no-such-id`, { status: "paused" }),
      env
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/experiments/:id", () => {
  it("deletes experiment and updates index", async () => {
    const mockDelete = vi.fn().mockResolvedValue(undefined);
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({
      FOG_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(["exp-del"])),
        put: mockPut,
        delete: mockDelete,
      },
    });
    const res = await handleExperiments(makeRequest("DELETE", `${BASE}/api/experiments/exp-del`), env);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.deleted).toBe("exp-del");
    expect(mockDelete).toHaveBeenCalledWith("experiment:exp-del");
    // index updated without exp-del
    expect(mockPut).toHaveBeenCalledWith("experiments:index", JSON.stringify([]));
  });
});

describe("Method not allowed", () => {
  it("returns 405 for unsupported method", async () => {
    const env = makeEnv();
    const res = await handleExperiments(makeRequest("OPTIONS", `${BASE}/api/experiments`), env);
    expect(res.status).toBe(405);
  });
});
