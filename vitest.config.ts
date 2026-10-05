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
          exclude: ["**/node_modules/**"],
        },
      },
    ],
  },
});
