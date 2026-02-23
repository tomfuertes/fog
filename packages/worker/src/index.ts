import type { Env } from "./types";
import { handleOptions } from "./lib/cors";
import { authenticate } from "./lib/auth";
import { handleInit } from "./routes/init";
import { handleTrack } from "./routes/track";
import { handleExperiments } from "./routes/experiments";
import { handleResults } from "./routes/results";
import { handleExport } from "./routes/export";
import { handleAnalytics } from "./routes/analytics";
import { handleScheduled } from "./cron/rotate-salt";

// Logs once per isolate lifetime (resets on cold start)
let bannerLogged = false;

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Lost in the Fog</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0d0d1a;
      color: #e0e0f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: #1a1a2e;
      padding: 1rem 2rem;
      border-bottom: 1px solid #2a2a4a;
    }
    header a { color: #a0a0d0; text-decoration: none; font-weight: 600; font-size: 1.1rem; }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      text-align: center;
    }
    .code { font-size: 6rem; font-weight: 700; color: #3a3a6a; line-height: 1; }
    h1 { font-size: 1.5rem; color: #a0a0d0; margin: 1rem 0 0.5rem; }
    p { color: #606080; margin-bottom: 2rem; }
    a.home {
      background: #1a1a2e;
      color: #a0a0d0;
      padding: 0.6rem 1.4rem;
      border-radius: 6px;
      text-decoration: none;
      border: 1px solid #2a2a4a;
      transition: border-color 0.2s;
    }
    a.home:hover { border-color: #5050a0; }
  </style>
</head>
<body>
  <header><a href="/">fog</a></header>
  <main>
    <div class="code">404</div>
    <h1>Lost in the Fog</h1>
    <p>This path doesn't exist or has drifted away.</p>
    <a class="home" href="/">Back to Dashboard</a>
  </main>
</body>
</html>`;

async function fetch(request: Request, env: Env): Promise<Response> {
  if (!bannerLogged && env.ENVIRONMENT !== "production") {
    bannerLogged = true;
    console.log(`
  ░░░░░░░░░░░░░░░░░░░░░░
  ░  f o g  |  dev     ░
  ░  A/B testing API   ░
  ░░░░░░░░░░░░░░░░░░░░░░
    `);
  }

  const { method } = request;
  const { pathname } = new URL(request.url);

  if (method === "OPTIONS") return handleOptions(request);

  // SDK endpoints - open CORS
  if (method === "GET" && pathname === "/init") return handleInit(request, env);
  if (method === "POST" && pathname === "/track") return handleTrack(request, env);

  // Admin endpoints - require API key
  if (pathname.startsWith("/api/")) {
    if (!authenticate(request, env)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (pathname.startsWith("/api/experiments")) {
      return handleExperiments(request, env);
    }
    if (method === "GET" && /^\/api\/results\/[^/]+$/.test(pathname)) {
      return handleResults(request, env);
    }
    if (method === "POST" && /^\/api\/export\/[^/]+$/.test(pathname)) {
      return handleExport(request, env);
    }
    if (method === "GET" && pathname === "/api/analytics") {
      return handleAnalytics(request, env);
    }
  }

  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Serve static assets (lander, dashboard, CSS, JS)
  return env.ASSETS.fetch(request);
}

async function scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
  await handleScheduled(env);
}

export default { fetch, scheduled };
