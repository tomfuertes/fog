// Workaround for wrangler dev hanging in Docker/devcontainers.
// Uses unstable_dev (which works) instead of `wrangler dev` (which doesn't).
// The proxy layer in `wrangler dev` fails to forward requests to workerd
// in some containerized arm64 environments.

import { unstable_dev } from "wrangler";

const worker = await unstable_dev("src/index.ts", {
  experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
  logLevel: "log",
  vars: {
    API_KEY: process.env.API_KEY || "dev-key",
    CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID || "fake",
    ENVIRONMENT: "development",
  },
  port: 8787,
});

console.log(`
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░  f o g  |  dev               ░
  ░  http://${worker.address}:${worker.port}  ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
`);

process.on("SIGINT", async () => {
  await worker.stop();
  process.exit(0);
});
