import type { Env } from "../types";

// Module-level cache - lives per isolate lifetime, auto-invalidates when
// date changes because the cache key includes the date string
let cached: { date: string; salt: string } | null = null;

export async function getSalt(env: Env): Promise<string> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (cached?.date === today) return cached.salt;

  const key = `salt:${today}`;
  let salt = await env.FOG_KV.get(key);
  if (!salt) {
    salt = generateSalt();
    await env.FOG_KV.put(key, salt);
  }

  cached = { date: today, salt };
  return salt;
}

export function generateSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
