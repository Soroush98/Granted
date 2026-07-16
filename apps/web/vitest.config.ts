import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests target pure logic in lib/. Two aliases make server modules
// importable outside a React Server context:
//   - "server-only" → an empty stub (the real package throws on import).
//   - "@"           → the app root, mirroring tsconfig's paths.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "lib/__tests__/stubs/server-only.ts"),
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
  },
});
