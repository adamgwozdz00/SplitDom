import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Vitest config (not Astro's getViteConfig) so tests never load the Cloudflare adapter.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/__tests__/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/*.db.test.ts"],
        },
      },
      {
        // Runs against local Supabase (`npx supabase start`); files run one at a time on a shared database.
        extends: true,
        test: {
          name: "db",
          include: ["src/**/__tests__/**/*.db.test.ts"],
          globalSetup: ["src/db/__tests__/global.setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
