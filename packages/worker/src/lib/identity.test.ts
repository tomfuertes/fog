import { describe, it, expect, vi } from "vitest";

// Hoisted above imports by Vitest - mocks getSalt for all identity tests
vi.mock("./salt", () => ({
  getSalt: vi.fn().mockResolvedValue("fixed-salt-abc123"),
}));

import { generateVisitorId } from "./identity";

describe("generateVisitorId", () => {
  const mockEnv = {} as any;

  function makeRequest(ip?: string, ua?: string, url = "https://example.com/") {
    const headers: Record<string, string> = {};
    if (ip) headers["CF-Connecting-IP"] = ip;
    if (ua) headers["User-Agent"] = ua;
    return new Request(url, { headers });
  }

  it("returns a 16-char hex string", async () => {
    const id = await generateVisitorId(makeRequest("1.2.3.4", "Mozilla/5.0"), mockEnv);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic - same inputs produce same ID", async () => {
    const [id1, id2] = await Promise.all([
      generateVisitorId(makeRequest("1.2.3.4", "Mozilla/5.0"), mockEnv),
      generateVisitorId(makeRequest("1.2.3.4", "Mozilla/5.0"), mockEnv),
    ]);
    expect(id1).toBe(id2);
  });

  it("different IPs produce different visitor IDs", async () => {
    const [id1, id2] = await Promise.all([
      generateVisitorId(makeRequest("1.2.3.4", "Mozilla/5.0"), mockEnv),
      generateVisitorId(makeRequest("5.6.7.8", "Mozilla/5.0"), mockEnv),
    ]);
    expect(id1).not.toBe(id2);
  });

  it("truncates IP to /24 - IPs differing only in last octet produce same ID", async () => {
    const [id1, id2] = await Promise.all([
      generateVisitorId(makeRequest("1.2.3.4", "Mozilla/5.0"), mockEnv),
      generateVisitorId(makeRequest("1.2.3.99", "Mozilla/5.0"), mockEnv),
    ]);
    expect(id1).toBe(id2);
  });

  it("falls back gracefully when CF-Connecting-IP and User-Agent are missing", async () => {
    const id = await generateVisitorId(makeRequest(), mockEnv);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});
