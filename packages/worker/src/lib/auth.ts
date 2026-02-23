import type { Env } from "../types";

export function authenticate(request: Request, env: Env): boolean {
  const key = request.headers.get("X-API-Key");
  return key !== null && key === env.API_KEY;
}
