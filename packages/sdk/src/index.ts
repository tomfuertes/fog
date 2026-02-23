export type { FogConfig, InitResponse, TrackOptions, SdkStatus, InitResult } from "./types.js";
import type { FogConfig, InitResponse, TrackOptions, InitResult, SdkStatus } from "./types.js";

// Module-level singleton state - use reset() to clear between tests / SSR renders
let _endpoint = "";
let _visitorId = "";
let _assignments: Record<string, number> = {};
let _status: SdkStatus = "pending";
// Teardown function for the dataLayer interceptor; null when not active
let _teardownDataLayer: (() => void) | null = null;
// Base URL for IIFE auto-mode (inferred from script tag src); null in ESM/npm mode
let _autoEndpoint: string | null = null;

/** FEAT-2: Current SDK lifecycle status */
export function getStatus(): SdkStatus {
  return _status;
}

/** FEAT-6: Clear all module-level state. Required for SSR and test environments. */
export function reset(): void {
  _endpoint = "";
  _visitorId = "";
  _assignments = {};
  _status = "pending";
  _autoEndpoint = null;
  if (_teardownDataLayer) {
    _teardownDataLayer();
    _teardownDataLayer = null;
  }
}

type DataLayerItem = Record<string, unknown>;
type DataLayerArray = DataLayerItem[] & { push: (...items: DataLayerItem[]) => number };

/** Wraps window.dataLayer.push to auto-fire conversion tracks on GA4 purchase events. */
function setupDataLayerInterception(): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as typeof window & { dataLayer?: DataLayerArray };
  if (!w.dataLayer) w.dataLayer = [] as unknown as DataLayerArray;
  const dl = w.dataLayer;
  const original = dl.push.bind(dl);
  dl.push = (...items: DataLayerItem[]): number => {
    for (const item of items) {
      if (item["event"] === "purchase") {
        const ec = item["ecommerce"] as Record<string, unknown> | undefined;
        const value = typeof ec?.["value"] === "number" ? (ec["value"] as number) : undefined;
        for (const experimentId of Object.keys(_assignments)) {
          track("conversion", { experimentId, value });
        }
      }
    }
    return original(...items);
  };
  return () => { dl.push = original; };
}

/** Sends a JSON payload to the /track endpoint via sendBeacon or fetch fallback. */
function post(url: string, payload: string): void {
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    // Blob ensures Content-Type: application/json (string defaults to text/plain)
    navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
  } else {
    fetch(url, { method: "POST", body: payload, headers: { "Content-Type": "application/json" } }).catch(() => {});
  }
}

/** FEAT-1: init with configurable timeout (default 5s). Never throws - resolves with error status on failure. */
export async function init(config: FogConfig): Promise<InitResult> {
  _endpoint = config.endpoint;
  _status = "pending";

  const timeoutMs = config.timeout ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = config.visitorId
    ? `${config.endpoint}/init?visitorId=${encodeURIComponent(config.visitorId)}`
    : `${config.endpoint}/init`;

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      _status = "error";
      return { status: "error", error: `HTTP ${res.status}` };
    }

    const data: InitResponse = await res.json();
    _visitorId = data.visitorId;
    _assignments = data.assignments;
    // Server returns assignments={} when visitor is excluded by traffic allocation
    _status = Object.keys(data.assignments).length === 0 ? "excluded" : "ready";
    if (config.autoRevenue && _status === "ready") {
      _teardownDataLayer = setupDataLayerInterception();
    }
    return { status: _status as "ready" | "excluded" };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === "AbortError";
    _status = "error";
    return { status: "error", error: isTimeout ? "timeout" : String(err) };
  }
}

/** Returns variant index, or -1 if not assigned (not initialized, excluded, or error) */
export function getVariant(experimentId: string): number {
  if (_status !== "ready") return -1;
  return _assignments[experimentId] ?? -1;
}

/** Feature flag convenience API - returns true if variant is 1 (enabled) */
export function isEnabled(experimentId: string): boolean {
  return getVariant(experimentId) === 1;
}

export function track(
  event: "impression" | "conversion",
  options: TrackOptions
): void {
  if (_status !== "ready") return;
  post(_endpoint + "/track", JSON.stringify({
    visitorId: _visitorId,
    experimentId: options.experimentId,
    event,
    eventName: options.eventName,
    value: options.value,
  }));
}

/**
 * Manually track a pageview - for SPA route changes.
 * In IIFE/script-tag mode: works immediately (no init() needed).
 * In npm mode: works after init() resolves.
 * @param path - URL path to record. Defaults to window.location.pathname.
 */
export function page(path?: string): void {
  const endpoint = _autoEndpoint ?? (_status === "ready" ? _endpoint : null);
  if (!endpoint) return;
  const p = path ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  post(endpoint + "/track", JSON.stringify({ event: "pageview", experimentId: "", eventName: p }));
}

declare const __IIFE__: boolean;

// IIFE auto-init: detect script tag context and auto-fire pageview on DOMContentLoaded.
// Dead-code eliminated from ESM build via esbuild define (__IIFE__ = false).
if (__IIFE__ && typeof document !== "undefined") {
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.src) {
    // Strip "/t.js" suffix to derive base endpoint URL
    const src = script.src;
    _autoEndpoint = src.endsWith("/t.js") ? src.slice(0, -5) : src.replace(/\/[^/]*$/, "");

    const fire = () => page(window.location.pathname + window.location.search);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fire, { once: true });
    } else {
      fire();
    }
  }
}
