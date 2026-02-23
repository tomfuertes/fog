import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, getVariant, isEnabled, getStatus, track, reset, page } from "./index.js";
import type { FogConfig } from "./types.js";

const ENDPOINT = "https://fog.example.com";

function mockFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: response.json ?? (() => Promise.resolve({})),
  });
}

beforeEach(() => {
  reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getStatus()", () => {
  it("starts as pending", () => {
    expect(getStatus()).toBe("pending");
  });
});

describe("reset()", () => {
  it("clears state back to pending", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ visitorId: "v1", assignments: { exp1: 0 } }),
      })
    );
    await init({ endpoint: ENDPOINT });
    expect(getStatus()).toBe("ready");
    reset();
    expect(getStatus()).toBe("pending");
    expect(getVariant("exp1")).toBe(-1);
  });
});

describe("init()", () => {
  it("sets status to ready on success with assignments", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ visitorId: "abc", assignments: { exp1: 1 } }),
      })
    );
    const result = await init({ endpoint: ENDPOINT });
    expect(result.status).toBe("ready");
    expect(getStatus()).toBe("ready");
  });

  it("sets status to excluded when assignments is empty", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () => Promise.resolve({ visitorId: "abc", assignments: {} }),
      })
    );
    const result = await init({ endpoint: ENDPOINT });
    expect(result.status).toBe("excluded");
    expect(getStatus()).toBe("excluded");
  });

  it("sets status to error on non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: false, status: 503 }));
    const result = await init({ endpoint: ENDPOINT });
    expect(result.status).toBe("error");
    expect(result.error).toBe("HTTP 503");
    expect(getStatus()).toBe("error");
  });

  it("sets status to error with 'timeout' on AbortError", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    const result = await init({ endpoint: ENDPOINT, timeout: 1 });
    expect(result.status).toBe("error");
    expect(result.error).toBe("timeout");
    expect(getStatus()).toBe("error");
  });

  it("sets status to error on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));
    const result = await init({ endpoint: ENDPOINT });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Network down");
  });

  it("appends visitorId query param when provided", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: () => Promise.resolve({ visitorId: "v99", assignments: { x: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, visitorId: "v99" });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENDPOINT}/init?visitorId=v99`,
      expect.objectContaining({ signal: expect.anything() })
    );
  });
});

describe("getVariant()", () => {
  it("returns -1 when not initialized (pending)", () => {
    expect(getVariant("exp1")).toBe(-1);
  });

  it("returns -1 when status is error", async () => {
    vi.stubGlobal("fetch", mockFetch({ ok: false, status: 500 }));
    await init({ endpoint: ENDPOINT });
    expect(getVariant("exp1")).toBe(-1);
  });

  it("returns -1 when status is excluded", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () => Promise.resolve({ visitorId: "v", assignments: {} }),
      })
    );
    await init({ endpoint: ENDPOINT });
    expect(getVariant("exp1")).toBe(-1);
  });

  it("returns correct variant index when ready", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ visitorId: "v", assignments: { exp1: 2, exp2: 0 } }),
      })
    );
    await init({ endpoint: ENDPOINT });
    expect(getVariant("exp1")).toBe(2);
    expect(getVariant("exp2")).toBe(0);
  });

  it("returns -1 for unknown experiment when ready", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ visitorId: "v", assignments: { exp1: 0 } }),
      })
    );
    await init({ endpoint: ENDPOINT });
    expect(getVariant("unknown-exp")).toBe(-1);
  });
});

describe("isEnabled()", () => {
  it("returns true when getVariant returns 1", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ visitorId: "v", assignments: { exp1: 1 } }),
      })
    );
    await init({ endpoint: ENDPOINT });
    expect(isEnabled("exp1")).toBe(true);
  });

  it("returns false when getVariant returns 0", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ visitorId: "v", assignments: { exp1: 0 } }),
      })
    );
    await init({ endpoint: ENDPOINT });
    expect(isEnabled("exp1")).toBe(false);
  });

  it("returns false when getVariant returns -1 (not assigned)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ok: true,
        json: () =>
          Promise.resolve({ visitorId: "v", assignments: {} }),
      })
    );
    await init({ endpoint: ENDPOINT });
    expect(isEnabled("unknown-exp")).toBe(false);
  });
});

describe("track()", () => {
  it("does nothing when status is pending", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    track("impression", { experimentId: "exp1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when status is error", async () => {
    const fetchMock = mockFetch({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT });
    fetchMock.mockClear();
    track("impression", { experimentId: "exp1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls fetch /track when sendBeacon is unavailable", async () => {
    const fetchMock = mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({ visitorId: "v1", assignments: { exp1: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    // Ensure no navigator.sendBeacon in test env (node doesn't have it)
    await init({ endpoint: ENDPOINT });
    fetchMock.mockClear();

    track("conversion", { experimentId: "exp1", value: 42 });
    // fetch is called async via .catch, give it a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENDPOINT}/track`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.event).toBe("conversion");
    expect(body.experimentId).toBe("exp1");
    expect(body.value).toBe(42);
    expect(body.visitorId).toBe("v1");
  });
});

describe("autoRevenue dataLayer interception", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeWindow: Record<string, any>;

  beforeEach(() => {
    fakeWindow = {};
    vi.stubGlobal("window", fakeWindow);
  });

  // afterEach vi.restoreAllMocks() (outer) restores the window stub

  function makeReadyFetch(assignments: Record<string, number> = { exp1: 0 }) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ visitorId: "v1", assignments }),
    });
  }

  it("does not set up interceptor when autoRevenue is false", async () => {
    const fetchMock = makeReadyFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: false });
    expect(fakeWindow["dataLayer"]).toBeUndefined();
  });

  it("creates window.dataLayer if it does not exist (Fog loads first)", async () => {
    const fetchMock = makeReadyFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: true } as FogConfig);
    expect(fakeWindow["dataLayer"]).toBeDefined();
    expect(typeof fakeWindow["dataLayer"]["push"]).toBe("function");
  });

  it("fires conversion track for each experiment on purchase push", async () => {
    const fetchMock = makeReadyFetch({ exp1: 0, exp2: 1 });
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: true } as FogConfig);
    fetchMock.mockClear();

    fakeWindow["dataLayer"].push({ event: "purchase", ecommerce: { value: 99.99 } });

    await new Promise((r) => setTimeout(r, 0));

    const trackCalls = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body));
    const expIds = trackCalls.map((b: { experimentId: string }) => b.experimentId).sort();
    expect(expIds).toEqual(["exp1", "exp2"]);
    for (const body of trackCalls) {
      expect(body.event).toBe("conversion");
      expect(body.value).toBe(99.99);
      expect(body.visitorId).toBe("v1");
    }
  });

  it("does not fire when push event is not 'purchase'", async () => {
    const fetchMock = makeReadyFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: true } as FogConfig);
    fetchMock.mockClear();

    fakeWindow["dataLayer"].push({ event: "page_view" });
    fakeWindow["dataLayer"].push({ event: "add_to_cart", ecommerce: { value: 10 } });

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes value as undefined when ecommerce.value is missing", async () => {
    const fetchMock = makeReadyFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: true } as FogConfig);
    fetchMock.mockClear();

    fakeWindow["dataLayer"].push({ event: "purchase", ecommerce: {} });

    await new Promise((r) => setTimeout(r, 0));
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.value).toBeUndefined();
  });

  it("wraps existing dataLayer when GA loads first", async () => {
    const existingItems: unknown[] = [];
    const originalPush = vi.fn((...items: unknown[]) => {
      existingItems.push(...items);
      return existingItems.length;
    });
    fakeWindow["dataLayer"] = { push: originalPush };

    const fetchMock = makeReadyFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: true } as FogConfig);
    fetchMock.mockClear();

    fakeWindow["dataLayer"].push({ event: "purchase", ecommerce: { value: 50 } });

    await new Promise((r) => setTimeout(r, 0));

    // Original push still called
    expect(originalPush).toHaveBeenCalledWith({ event: "purchase", ecommerce: { value: 50 } });
    // Conversion track also fired
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.event).toBe("conversion");
    expect(body.value).toBe(50);
  });

  it("stops intercepting after reset()", async () => {
    const fetchMock = makeReadyFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: true } as FogConfig);

    reset();
    fetchMock.mockClear();

    // After reset, push is restored; purchase should not trigger track (status is pending)
    if (fakeWindow["dataLayer"]) {
      fakeWindow["dataLayer"].push({ event: "purchase", ecommerce: { value: 20 } });
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not intercept when status is excluded (empty assignments)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ visitorId: "v1", assignments: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT, autoRevenue: true } as FogConfig);
    // dataLayer not installed because status is excluded
    expect(fakeWindow["dataLayer"]).toBeUndefined();
  });
});

describe("page()", () => {
  it("does nothing when status is pending and no autoEndpoint", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    page("/about");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends pageview after init() when ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ visitorId: "v1", assignments: { exp1: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT });
    fetchMock.mockClear();

    page("/contact");
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledWith(
      `${ENDPOINT}/track`,
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.event).toBe("pageview");
    expect(body.eventName).toBe("/contact");
    expect(body.experimentId).toBe("");
  });

  it("uses window.location.pathname when path is omitted", async () => {
    vi.stubGlobal("window", { location: { pathname: "/current-path" } });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ visitorId: "v1", assignments: { exp1: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await init({ endpoint: ENDPOINT });
    fetchMock.mockClear();

    page();
    await new Promise((r) => setTimeout(r, 0));

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.eventName).toBe("/current-path");
  });
});
