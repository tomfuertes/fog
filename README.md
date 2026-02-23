# Fog

**A/B testing that doesn't watch your users.** Privacy-first experimentation on Cloudflare Workers. No cookies. No consent banners. No vendor lock-in.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![~1KB SDK](https://img.shields.io/badge/SDK-~1KB-green.svg)](packages/sdk)
[![Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com)

---

Drop one script tag. Get GDPR-compliant analytics and A/B testing that works on first pageview, for every visitor, without asking permission.

- **No cookies** - visitor identity computed server-side, nothing stored in the browser
- **No consent banner** - uses the [CNIL-approved](https://www.cnil.fr/en/sheet-ndeg16-use-analytics-your-websites-and-applications) anonymous analytics pattern
- **~1KB SDK** - less than a favicon
- **Bayesian statistics** - "94% probability B beats A", not p-value theater
- **Self-hosted** - runs on your Cloudflare account, free tier handles most sites
- **Dashboard included** - experiment management, results, CSV export, all from the same Worker

---

## Quick Start

> **Don't want to self-host?** Use [fogalytics.com](https://fogalytics.com) - same open-source code, zero ops.

### Analytics (script tag)

```html
<script src="https://your-worker.example.com/fog.iife.js"></script>
<script>
  Fog.init({ endpoint: 'https://your-worker.example.com' }).then(() => {
    Fog.track('impression', { experimentId: 'homepage-hero' });
  });
</script>
```

### A/B Testing (npm)

```bash
npm install @fogalytics/sdk
```

```js
import { init, getVariant, track } from '@fogalytics/sdk';

await init({ endpoint: 'https://your-worker.example.com' });

const variant = getVariant('homepage-hero');
// 0 = control, 1 = treatment, -1 = not in experiment

if (variant === 1) showNewHero();

track('impression', { experimentId: 'homepage-hero' });
// later, on conversion:
track('conversion', { experimentId: 'homepage-hero', value: 49.99 });
```

### Deploy Your Own

```bash
npm ci && npm run deploy
```

Dashboard is at your Worker's root URL. [Full setup below.](#installation)

---

## Why No Consent Banner?

Visitor identity is computed server-side: `HMAC-SHA256(daily_salt, truncated_IP + UA + domain)`.

- Salt rotates at midnight UTC. Yesterday's is permanently deleted via cron - re-identification is mathematically impossible even under compulsion.
- The SDK stores nothing client-side. No cookies, no localStorage, no IndexedDB.
- IP is truncated to /24 before hashing (last octet dropped).
- Different salt each day means different ID each day - no longitudinal tracking possible.

This is the CNIL-approved pattern for cookie-exempt analytics. First pageview works. Every visitor. No permission required.

## Bayesian Statistics

Results show **P(treatment beats control)** via Beta-Binomial Monte Carlo (10k samples).

```
control:    512 impressions, 26 conversions (5.1%)
treatment:  519 impressions, 36 conversions (6.9%)
probability: 0.943 ← 94.3% chance treatment is better
```

No p-values. No "statistical significance" thresholds to debate. The number means what you think it means.

## What Fog Will Never Do

These are not missing features. They are the complexity traps this project exists to reject.

- **Multi-armed bandits** - Bayesian stopping rules solve the same problem transparently
- **Visual editor** - DOM manipulation breaks with every redesign; this is where Optimizely went wrong
- **Audience targeting** - A bottomless pit. Fog's power is that it's stateless.
- **Multi-touch attribution** - Fog measures experiments, not journeys

---

## Installation

### Prerequisites

- Node.js 18+
- Cloudflare account with Workers, KV, Analytics Engine, and R2 enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) authenticated

### Provision Resources

```bash
# Create KV namespace and R2 bucket
npx wrangler kv namespace create FOG_KV
npx wrangler r2 bucket create fog-exports

# Set secrets
npx wrangler secret put API_KEY          # your chosen admin API key
npx wrangler secret put CF_API_TOKEN     # Cloudflare API token (Analytics Engine SQL access)
npx wrangler secret put CF_ACCOUNT_ID    # your Cloudflare account ID
```

Update `packages/worker/wrangler.toml` with the KV namespace ID from the first command, then:

```bash
npm run deploy
```

### Local Development

```bash
cp packages/worker/.dev.vars.example packages/worker/.dev.vars
# Edit .dev.vars with your values (or leave defaults for local dev)
npm run dev    # wrangler dev on localhost:8787
```

---

## SDK Reference

### `init(config)`

Initialize the SDK. Never throws - always resolves.

```ts
init(config: FogConfig): Promise<InitResult>
```

**`FogConfig`**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoint` | `string` | required | Worker base URL |
| `visitorId` | `string` | - | Override anonymous ID (use for logged-in users) |
| `timeout` | `number` | `5000` | Fetch timeout in ms |
| `autoRevenue` | `boolean` | - | Auto-capture GA4 `purchase` events from `window.dataLayer` |

**`InitResult`**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `'ready' \| 'excluded' \| 'error'` | `excluded` = visitor outside traffic allocation |
| `error` | `string` | Present when `status === 'error'`. E.g. `'timeout'`, `'HTTP 503'` |

```js
const result = await init({ endpoint: 'https://fogalytics.com' });

if (result.status === 'excluded') {
  // Visitor outside traffic allocation - show default experience
} else if (result.status === 'error') {
  console.warn('Fog init failed:', result.error);
}
// getVariant() returns -1 when not ready - safe to call regardless
```

### `getVariant(experimentId)`

Returns variant index, or `-1` if not assigned.

```ts
getVariant(experimentId: string): number
// 0 = control, 1 = treatment, -1 = not in experiment / not ready
```

### `track(event, options)`

Fire-and-forget event. No-ops if not ready.

```ts
track(event: 'impression' | 'conversion', options: TrackOptions): void
```

| Field | Type | Description |
|-------|------|-------------|
| `experimentId` | `string` | Experiment to record against |
| `eventName` | `string` | Optional label for conversion type |
| `value` | `number` | Optional revenue value |

### `getStatus()`

```ts
getStatus(): SdkStatus  // 'pending' | 'ready' | 'excluded' | 'error'
```

### `reset()`

Clear all module state. Required for SSR and test isolation.

### Logged-in Users

Pass a stable ID for cross-device consistency:

```js
await init({ endpoint: 'https://fogalytics.com', visitorId: user.id });
```

### Auto Revenue Tracking

If you already have GA4 ecommerce instrumentation, Fog can piggyback on it:

```js
await init({
  endpoint: 'https://fogalytics.com',
  autoRevenue: true,  // intercepts window.dataLayer.push for 'purchase' events
});
```

Any GA4 `purchase` event automatically fires a conversion track with the `ecommerce.value` for every active experiment. No additional instrumentation needed.

---

## Admin API

All `/api/*` endpoints require `X-API-Key` header.

### Experiments

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/experiments` | List all experiments |
| `POST` | `/api/experiments` | Create experiment |
| `GET` | `/api/experiments/:id` | Get experiment |
| `PUT` | `/api/experiments/:id` | Update experiment |
| `DELETE` | `/api/experiments/:id` | Delete experiment |

**Create payload:**

```json
{
  "name": "Homepage CTA",
  "variants": ["control", "treatment"],
  "trafficPercent": 100
}
```

Defaults: `variants` = `["control", "treatment"]`, `trafficPercent` = `100`, `status` = `"active"`.

### Results

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/results/:id` | Per-variant stats + P(B>A) |
| `POST` | `/api/export/:id` | Export raw events as CSV to R2 |

**Results response:**

```json
{
  "experimentId": "uuid",
  "variants": [
    { "index": 0, "name": "control", "impressions": 1024, "conversions": 52, "conversionRate": 0.0508, "totalRevenue": 0, "revenuePerVisitor": 0 },
    { "index": 1, "name": "treatment", "impressions": 1031, "conversions": 71, "conversionRate": 0.0689, "totalRevenue": 3249.50, "revenuePerVisitor": 3.15 }
  ],
  "probability": 0.943
}
```

`probability` is P(treatment beats control) via Bayesian Beta-Binomial Monte Carlo (10k samples).

### Tracking (open, no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/init` | Get anonymous visitor ID + experiment assignments |
| `POST` | `/track` | Track impression or conversion |

Open CORS (`Access-Control-Allow-Origin: *`).

---

## Dashboard

Served at the Worker's root URL. On first visit, prompts for your API key (stored in sessionStorage only - cleared on tab close, never persisted).

Three views:
- **Experiment list** - status, variants, traffic allocation
- **Create experiment** - name, variants, traffic % slider
- **Results** - per-variant conversion rates + revenue, P(B>A) probability badge, pause/resume/complete controls, CSV export

---

## Architecture

```
Browser SDK (~1KB)              Dashboard SPA
  GET /init                       /api/*
  POST /track (Beacon API)
        |                           |
        v                           v
  +-----------------------------------------+
  |         Cloudflare Worker               |
  |  /init    - anonymous ID + assignments  |
  |  /track   - event ingestion             |
  |  /api/*   - experiment CRUD + results   |
  |  /*       - dashboard static assets     |
  +------+----------+----------+------------+
         |          |          |
      KV Store   Analytics   R2 Bucket
      (config    Engine      (CSV exports)
       + salts)  (events)
```

## Privacy Model

| What others do | What Fog does |
|----------------|---------------|
| Set cookies, require consent banner | No cookies. Visitor ID is a JSON field held in a JS variable. |
| Store fingerprints client-side | SDK stores nothing. No localStorage, no IndexedDB, no cookies. |
| Hash full IP addresses | Truncate to /24 (drop last octet) before HMAC. |
| Keep salts/keys indefinitely | Daily HMAC salt. Yesterday's permanently deleted at midnight UTC. |
| Store PII in analytics | Analytics Engine stores opaque hashed IDs and event counts only. |
| Require consent for every visitor | First pageview works. Same visitor, same day = same deterministic ID. |
| Enable cross-site tracking | Different salt each day = different ID = no longitudinal tracking possible. |

## Project Structure

```
fog/
├── packages/
│   ├── sdk/                     # Browser SDK (~1KB)
│   │   ├── src/
│   │   │   ├── index.ts         # init(), getVariant(), track()
│   │   │   ├── hash.ts          # FNV-1a bucketing
│   │   │   └── types.ts
│   │   └── build.mjs            # esbuild -> ESM + IIFE
│   └── worker/                  # Cloudflare Worker
│       ├── src/
│       │   ├── index.ts         # Router + scheduled handler
│       │   ├── types.ts         # Shared interfaces
│       │   ├── routes/          # init, track, experiments, results, export
│       │   ├── lib/             # identity, salt, hash, cors, auth, analytics, stats
│       │   └── cron/            # Salt rotation
│       └── public/              # Dashboard SPA (vanilla JS)
└── package.json                 # npm workspaces root
```

## Design Decisions

- **FNV-1a for bucketing** - Duplicated in both SDK and Worker (10 lines each, intentionally not a shared package). The hash function is stable and simple enough that a shared dependency would add more complexity than it removes.
- **Bayesian over frequentist stats** - Beta-Binomial Monte Carlo (10k samples) gives P(B beats A) directly. No p-values, no required sample size calculators, no "statistical significance" theater.
- **Analytics Engine over D1** - Event ingestion via `writeDataPoint()` is zero-latency and free-tier friendly. SQL queries via the Cloudflare API for reads. No database to manage.
- **Vanilla JS dashboard** - No React, no build step for the dashboard. 350 lines of JS served as a static asset.

## License

MIT
