import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // IIFE auto-init is gated by this constant. Tests run in ESM/node mode so it's false.
    __IIFE__: false,
  },
  test: {
    environment: "node",
  },
});
