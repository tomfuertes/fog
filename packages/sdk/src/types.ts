export interface FogConfig {
  endpoint: string;
  visitorId?: string;
  /** Fetch timeout in ms. Defaults to 5000. On timeout, SDK resolves with empty config. */
  timeout?: number;
  /**
   * When true, intercepts window.dataLayer.push to detect GA4 `purchase` events
   * and auto-fire conversion tracks for all active experiments.
   */
  autoRevenue?: boolean;
}

export type SdkStatus = "pending" | "ready" | "excluded" | "error";

export interface InitResult {
  status: "ready" | "excluded" | "error";
  /** Present when status is 'error' */
  error?: string;
}

export interface InitResponse {
  visitorId: string;
  assignments: Record<string, number>;
}

export interface TrackOptions {
  experimentId: string;
  eventName?: string;
  value?: number;
}
