export interface Env {
  FOG_KV: KVNamespace;
  FOG_ANALYTICS: AnalyticsEngineDataset;
  FOG_R2: R2Bucket;
  ASSETS: Fetcher;
  API_KEY: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  ENVIRONMENT: string;
}

export interface Experiment {
  id: string;
  name: string;
  variants: string[];
  trafficPercent: number; // 0-100
  status: "active" | "paused" | "completed";
  type?: "experiment" | "flag"; // default: "experiment"
  createdAt: string;
  updatedAt: string;
  // Auto-stopping fields
  winner?: string; // variant name that won
  completedAt?: string; // ISO timestamp when auto-stopped
  minSamplesPerVariant?: number; // default 100
  autoStop?: boolean; // default true for experiments
}

export interface TrackPayload {
  visitorId: string;
  experimentId: string;
  event: "impression" | "conversion" | "pageview";
  variantIndex?: number;
  eventName?: string;
  value?: number;
}

export interface InitResponse {
  visitorId: string;
  assignments: Record<string, number>; // experimentId -> variantIndex
}
