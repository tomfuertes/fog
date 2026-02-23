/**
 * Integration tests - hit real HTTP endpoints via wrangler unstable_dev.
 * Analytics Engine and R2 are NOT available in local mode:
 *   - /track still returns 204 (writeEvent is fire-and-forget, not awaited)
 *   - /api/results returns 502 (CF API unreachable with fake creds)
 * All other KV-backed operations work via wrangler's local KV simulation.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import type { Unstable_DevWorker } from "wrangler";
import { bucket } from "./lib/hash";

const API_KEY = "test-key";

let worker: Unstable_DevWorker;
let base: string;

beforeAll(async () => {
  worker = await unstable_dev("src/index.ts", {
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
    logLevel: "error",
    vars: { API_KEY, CF_ACCOUNT_ID: "fake", ENVIRONMENT: "test" },
  });
  base = `http://${worker.address}:${worker.port}`;
}, 30_000);

afterAll(async () => {
  await worker.stop();
});

// ─── helpers ────────────────────────────────────────────────────────────────

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", "X-API-Key": API_KEY, ...extra };
}

async function createExperiment(
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; name: string; variants: string[]; trafficPercent: number; status: string }> {
  const body = { name: "Integration Test Exp", ...overrides };
  const res = await fetch(`${base}/api/experiments`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return res.json() as any;
}

async function getInit(params: Record<string, string> = {}): Promise<{ visitorId: string; assignments: Record<string, number> }> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/init${qs ? `?${qs}` : ""}`);
  expect(res.status).toBe(200);
  return res.json() as any;
}

async function postTrack(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Full lifecycle ──────────────────────────────────────────────────────────

describe("Full experiment lifecycle", () => {
  it("creates, assigns, tracks, pauses, and deletes an experiment", async () => {
    // 1. Create
    const exp = await createExperiment({ name: "Lifecycle Test" });
    expect(exp.id).toBeTruthy();
    expect(exp.name).toBe("Lifecycle Test");
    expect(exp.variants).toEqual(["control", "treatment"]);
    expect(exp.status).toBe("active");

    const experimentId = exp.id;

    // 2. Verify it appears in GET /api/experiments list
    const listRes = await fetch(`${base}/api/experiments`, { headers: adminHeaders() });
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as any[];
    expect(list.some((e: any) => e.id === experimentId)).toBe(true);

    // 3. GET /init for several visitors - all should get an assignment
    const visitors = ["visitor-a", "visitor-b", "visitor-c"];
    for (const visitorId of visitors) {
      const init = await getInit({ visitorId });
      expect(init.visitorId).toBe(visitorId);
      expect(init.assignments).toHaveProperty(experimentId);
      const variant = init.assignments[experimentId];
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThanOrEqual(1);
    }

    // 4. POST /track impression + conversion
    const visitorId = "lifecycle-visitor";
    const impRes = await postTrack({ visitorId, experimentId, event: "impression" });
    expect(impRes.status).toBe(204);

    const convRes = await postTrack({ visitorId, experimentId, event: "conversion" });
    expect(convRes.status).toBe(204);

    // 5. GET /api/results - returns 502 in local mode (AE unavailable) but
    //    validates the endpoint exists and is auth-gated
    const resultsRes = await fetch(`${base}/api/results/${experimentId}`, {
      headers: adminHeaders(),
    });
    // 200 or 502 depending on AE availability - both are acceptable in local mode
    expect([200, 502]).toContain(resultsRes.status);

    // 6. PATCH to pause
    const patchRes = await fetch(`${base}/api/experiments/${experimentId}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ status: "paused" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json() as any;
    expect(patched.status).toBe("paused");
    expect(patched.id).toBe(experimentId); // id immutable

    // 7. Paused experiment should not appear in /init assignments
    const initAfterPause = await getInit({ visitorId: "post-pause-visitor" });
    expect(initAfterPause.assignments[experimentId]).toBeUndefined();

    // 8. DELETE
    const delRes = await fetch(`${base}/api/experiments/${experimentId}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    expect(delRes.status).toBe(200);
    const deleted = await delRes.json() as any;
    expect(deleted.deleted).toBe(experimentId);

    // 9. Verify gone from list
    const listAfterDelete = await fetch(`${base}/api/experiments`, { headers: adminHeaders() });
    const finalList = await listAfterDelete.json() as any[];
    expect(finalList.some((e: any) => e.id === experimentId)).toBe(false);
  });
});

// ─── Bucketing determinism ───────────────────────────────────────────────────

describe("Bucketing determinism", () => {
  it("returns the same variant for the same visitorId across multiple /init calls", async () => {
    const exp = await createExperiment({ name: "Determinism Test" });
    const experimentId = exp.id;
    const visitorId = "stable-visitor-determinism";

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getInit({ visitorId }))
    );

    const variants = results.map(r => r.assignments[experimentId]);
    expect(new Set(variants).size).toBe(1); // all identical
  });

  it("variant assignment matches local bucket() computation", async () => {
    const exp = await createExperiment({ name: "Bucket Match Test" });
    const experimentId = exp.id;
    const visitorId = "bucket-check-visitor";

    const init = await getInit({ visitorId });
    const actual = init.assignments[experimentId];
    const expected = bucket(visitorId, experimentId, 2, 100);

    expect(actual).toBe(expected);
  });

  it("different visitors get different variants (distribution sanity check)", async () => {
    const exp = await createExperiment({ name: "Distribution Test" });
    const experimentId = exp.id;

    // Sample 20 visitors and expect both variants to appear
    const assignments = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        getInit({ visitorId: `dist-visitor-${i}` }).then(r => r.assignments[experimentId])
      )
    );

    const unique = new Set(assignments.filter(v => v !== undefined));
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ─── Traffic exclusion ───────────────────────────────────────────────────────

describe("Traffic exclusion (trafficPercent=0)", () => {
  it("no visitors are assigned when trafficPercent=0", async () => {
    const exp = await createExperiment({ name: "Zero Traffic", trafficPercent: 0 });
    const experimentId = exp.id;

    for (const visitorId of ["v1", "v2", "v3", "v4", "v5"]) {
      const init = await getInit({ visitorId });
      expect(init.assignments[experimentId]).toBeUndefined();
    }
  });
});

// ─── Validation errors → 400 ────────────────────────────────────────────────

describe("Validation errors return 400", () => {
  it("POST /api/experiments - missing name", async () => {
    const res = await fetch(`${base}/api/experiments`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ variants: ["a", "b"] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/name/);
  });

  it("POST /api/experiments - fewer than 2 variants", async () => {
    const res = await fetch(`${base}/api/experiments`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "x", variants: ["only"] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/variants/);
  });

  it("POST /api/experiments - trafficPercent > 100", async () => {
    const res = await fetch(`${base}/api/experiments`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "x", trafficPercent: 101 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/experiments - trafficPercent < 0", async () => {
    const res = await fetch(`${base}/api/experiments`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "x", trafficPercent: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /track - missing required fields", async () => {
    const res = await postTrack({ visitorId: "v1" }); // missing experimentId + event
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/required/);
  });

  it("POST /track - invalid JSON", async () => {
    const res = await fetch(`${base}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/experiments/:id - variant mutation rejected", async () => {
    const exp = await createExperiment({ name: "Variant Mutation Guard" });
    const res = await fetch(`${base}/api/experiments/${exp.id}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ variants: ["x", "y", "z"] }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/variants/);
  });
});

// ─── Auth enforcement ────────────────────────────────────────────────────────

describe("API key auth enforced on admin routes", () => {
  it("GET /api/experiments - 401 without X-API-Key", async () => {
    const res = await fetch(`${base}/api/experiments`);
    expect(res.status).toBe(401);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Unauthorized/);
  });

  it("POST /api/experiments - 401 without X-API-Key", async () => {
    const res = await fetch(`${base}/api/experiments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Should Fail" }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /api/experiments/:id - 401 without X-API-Key", async () => {
    const res = await fetch(`${base}/api/experiments/some-id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/experiments/:id - 401 without X-API-Key", async () => {
    const res = await fetch(`${base}/api/experiments/some-id`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/results/:id - 401 without X-API-Key", async () => {
    const res = await fetch(`${base}/api/results/abc123def456`);
    expect(res.status).toBe(401);
  });

  it("GET /init - no auth required (SDK endpoint)", async () => {
    const res = await fetch(`${base}/init`);
    expect(res.status).toBe(200);
  });

  it("POST /track - no auth required (SDK endpoint)", async () => {
    // Will 404 on experiment, but not 401
    const res = await postTrack({ visitorId: "v", experimentId: "nonexistent", event: "impression" });
    expect(res.status).not.toBe(401);
  });

  it("wrong API key returns 401", async () => {
    const res = await fetch(`${base}/api/experiments`, {
      headers: { "X-API-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
  });
});

// ─── Unknown experiment on /track returns 404 ────────────────────────────────

describe("Unknown experiment on /track", () => {
  it("returns 404 for a non-existent experimentId", async () => {
    const res = await postTrack({
      visitorId: "some-visitor",
      experimentId: "00000000-0000-0000-0000-000000000000",
      event: "impression",
    });
    expect(res.status).toBe(404);
    const json = await res.json() as any;
    expect(json.error).toMatch(/not found/i);
  });
});
