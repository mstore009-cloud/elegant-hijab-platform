import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/**/*.test.{ts,tsx}", "client/**/*.spec.{ts,tsx}"],
    // Integration specs use the same managed database and clean their own rows.
    // Running files in parallel can make one spec delete a fixture another still uses.
    fileParallelism: false,
  },
});
