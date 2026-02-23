# Fog - Privacy-First Experimentation & Analytics

## Vision

Two audiences, one infrastructure. The CNIL-compliant identity model (HMAC + daily salt)
is the shared primitive. Analytics (pageview tracking via script tag) is the wedge.
Experiments (A/B testing, feature flags via npm SDK) are the upsell. Both run on the
same Worker, same identity system, same dashboard.

Anti-goals: multi-armed bandits, visual editors, audience targeting/segmentation,
multi-touch attribution. These are the complexity traps the project exists to reject.

## Project Structure

npm workspaces monorepo with two packages:

- `packages/sdk/` - Browser SDK (~1KB). ESM + IIFE via esbuild. `npm run build -w packages/sdk`
- `packages/worker/` - Cloudflare Worker (API + Dashboard). `npm run dev` starts wrangler dev on :8787

## Key Commands

```bash
npm ci                           # install (lockfile-only)
npm run dev                      # wrangler dev on localhost:8787
npm run build                    # build SDK then Worker
npm run typecheck                # tsc --noEmit both packages
npm test                         # vitest in worker package
npm run deploy                   # wrangler deploy
```

## Architecture

Worker handles everything: SDK endpoints (`/init`, `/track` - open CORS), admin API (`/api/*` - requires `X-API-Key` header), and dashboard static files (served via `[assets]` binding).

### Identity Model

`HMAC-SHA256(daily_salt, truncated_IP + UA + hostname)` - salt rotates at midnight UTC, yesterday's permanently deleted via cron. No cookies, no localStorage. This is the CNIL-approved anonymous analytics pattern.

### Data Flow

- KV Store: experiment config (`experiment:<id>`, `experiments:index`), daily salts (`salt:YYYY-MM-DD`)
- Analytics Engine: event ingestion via `writeDataPoint()`. Schema: blob1=experimentId, blob2=variantIndex, blob3=eventType, blob4=eventName, double1=value, index1=visitorId
- R2: CSV exports at `exports/<experimentId>/<timestamp>.csv`

### Hash Function

FNV-1a for experiment bucketing - duplicated in both `packages/sdk/src/hash.ts` and `packages/worker/src/lib/hash.ts` (10 lines, intentionally not a shared package). Changes must be synced manually.

### Stats

Bayesian Beta-Binomial via Monte Carlo (10k samples) in `packages/worker/src/lib/stats.ts`. Normal approximation to Beta distribution via Box-Muller. Returns P(treatment beats control).

## Secrets (set via `wrangler secret put`)

- `API_KEY` - admin API authentication
- `CF_API_TOKEN` - Cloudflare API token for Analytics Engine SQL queries
- `CF_ACCOUNT_ID` - Cloudflare account ID for API calls

## Testing

Root `npm test` only runs worker package. SDK tests require separate run:
```bash
npm run test -w packages/sdk    # 27 tests (hash, init, bundle size)
npm test                        # 98 tests (worker routes, integration)
```

## Bucketing Nuance

Current `bucket()` rescales `n` within the traffic window to pick a variant. This means
variant assignments shift when `trafficPercent` changes. Fine for experiments (don't change
traffic mid-test), but breaks progressive rollout for feature flags. Flag mode needs
threshold-based bucketing: `n < trafficPercent/100 ? 1 : 0` (ramp-stable, no rescaling).
See task #41.

## Open-Source Split

Public repo (`tomfuertes/fogalytics`) contains all source code, MIT licensed, fully self-hostable.
Private repo (`fogalytics-hosted`) contains only deployment config (`wrangler.toml` with real IDs, `deploy.sh`).
No submodules - deploy.sh clones public repo, overlays config, deploys.

`packages/worker/wrangler.toml` has placeholder IDs. Local dev (`dev.mjs`) and tests use
`unstable_dev()` with inline vars - they never read wrangler.toml IDs.

## Pricing Model (Deferred)

Three tiers under consideration:
- **Free (self-host)**: Full platform, unlimited, on your own Cloudflare account
- **Paid SaaS (fogalytics.com)**: Usage-based pricing. Free below thresholds (pageviews).
  A/B testing as additive paid feature on top of free analytics.
- **Enterprise**: Services engagement, not a software tier. Project-based fee/retainer
  for managed deployment on customer's infrastructure, custom installs, managed updates.

GitLab model for code: premium dashboard features (enhanced viz, team seats, billing) live
in the private repo only. Public repo dashboard stays bare-bones functional.

No `PLAN_TIER` code exists yet. Implement when pricing is finalized.

## Multi-Tenant Architecture (fog-cloud, separate private repo)

Hosted offering uses Option A: single Worker, KV keys prefixed by account ID.
Schema: `a:<accountId>:e:<experimentId>`. fog-cloud wraps fog Worker with auth +
billing middleware. See `docs/business-model.md` for full architecture.

## Gotchas

- Analytics Engine SQL API doesn't support parameterized queries. Experiment IDs are validated against `/^[a-f0-9-]+$/` before interpolation (see `routes/results.ts`, `routes/export.ts`).
- `sendBeacon` with a plain string sends `Content-Type: text/plain`. SDK wraps payload in `Blob` with `application/json` type.
- Salt cache is module-level (per isolate). Cache key includes date string so it auto-invalidates daily without explicit TTL.
- Dashboard API key stored in `sessionStorage` only - clears on tab close, never persisted.
- Revenue data (double1) is already written to Analytics Engine via track events but the results endpoint doesn't surface it yet (task #39).
- GA dataLayer interception for auto-revenue tracking is planned (task #40). Intercept `dataLayer.push` to catch `purchase` events without manual instrumentation.
