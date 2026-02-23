import type { Env } from "../types";
import { getSalt } from "./salt";

export async function generateVisitorId(
  request: Request,
  env: Env
): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
  // Truncate to /24 (drop last octet) for privacy before hashing
  const truncatedIp = ip.split(".").slice(0, 3).join(".");
  const ua = request.headers.get("User-Agent") ?? "";
  const hostname = new URL(request.url).hostname;

  const salt = await getSalt(env);

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    keyMaterial,
    encoder.encode(truncatedIp + ua + hostname)
  );

  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}
