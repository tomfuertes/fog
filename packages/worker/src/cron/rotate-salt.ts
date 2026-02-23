import type { Env } from "../types";
import { generateSalt } from "../lib/salt";

export async function handleScheduled(env: Env): Promise<void> {
  const today = new Date();

  // Pre-generate tomorrow's salt so first requests of the day don't cold-generate it
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowKey = `salt:${tomorrow.toISOString().slice(0, 10)}`;
  const alreadyExists = await env.FOG_KV.get(tomorrowKey);
  if (!alreadyExists) {
    await env.FOG_KV.put(tomorrowKey, generateSalt());
  }

  // Delete yesterday's salt - no longer needed
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await env.FOG_KV.delete(`salt:${yesterday.toISOString().slice(0, 10)}`);
}
