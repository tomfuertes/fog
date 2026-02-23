// Plain ESM - no TypeScript syntax so node can run this directly
import esbuild from "esbuild";
import { spawnSync } from "child_process";
import { rmSync } from "fs";

// Clean stale artifacts before rebuilding
rmSync("dist", { recursive: true, force: true });

const shared = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  target: "es2020",
};

await esbuild.build({
  ...shared,
  format: "esm",
  outfile: "dist/fog.esm.js",
  define: { __IIFE__: "false" },
});

await esbuild.build({
  ...shared,
  format: "iife",
  globalName: "Fog",
  outfile: "dist/fog.iife.js",
  define: { __IIFE__: "true" },
});

// Generate TypeScript declarations
spawnSync("tsc", ["--emitDeclarationOnly"], { stdio: "inherit" });

console.log("Build complete: dist/fog.esm.js, dist/fog.iife.js, dist/index.d.ts");
