import type { Env, TrackPayload } from "../types";

export type AnalyticsEvent = TrackPayload & { variantIndex: number };

export function writeEvent(env: Env, data: AnalyticsEvent): void {
  env.FOG_ANALYTICS.writeDataPoint({
    blobs: [
      data.experimentId,       // blob1: experiment identifier
      String(data.variantIndex), // blob2: which variant (0=control, 1=treatment, ...)
      data.event,              // blob3: "impression" | "conversion"
      data.eventName ?? "",    // blob4: optional named event
    ],
    doubles: [data.value ?? 1], // double1: numeric value (default 1 for counting)
    indexes: [data.visitorId],  // index1: for per-visitor cardinality queries
  });
}
