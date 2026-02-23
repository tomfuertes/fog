import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

const SDK_ROOT = resolve(import.meta.dirname, "..");

describe("Bundle Size", () => {
  beforeAll(() => {
    // Build the SDK
    execSync("node build.mjs", {
      cwd: SDK_ROOT,
      stdio: "inherit",
    });
  });

  it("ESM bundle should be under 2KB", () => {
    const esmPath = resolve(SDK_ROOT, "dist/fog.esm.js");
    const content = readFileSync(esmPath, "utf-8");
    const sizeKB = Buffer.byteLength(content, "utf-8") / 1024;

    console.log(`ESM bundle size: ${sizeKB.toFixed(2)}KB`);
    expect(sizeKB).toBeLessThan(2);
  });

  it("IIFE bundle should be under 3KB", () => {
    const iifePath = resolve(SDK_ROOT, "dist/fog.iife.js");
    const content = readFileSync(iifePath, "utf-8");
    const sizeKB = Buffer.byteLength(content, "utf-8") / 1024;

    console.log(`IIFE bundle size: ${sizeKB.toFixed(2)}KB`);
    expect(sizeKB).toBeLessThan(3);
  });
});
