export function corsHeaders(
  _origin: string | null,
  isAdmin: boolean
): Record<string, string> {
  if (isAdmin) {
    // Admin endpoints: dashboard is co-located on the same worker origin,
    // so no ACAO header is needed. Omitting it blocks all cross-origin admin requests.
    return {
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    };
  }
  // SDK endpoints: open CORS
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function handleOptions(request: Request): Response {
  const origin = request.headers.get("Origin");
  const isAdmin = new URL(request.url).pathname.startsWith("/api/");
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, isAdmin),
  });
}
