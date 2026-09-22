import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Autoload imports plugin files with a dynamic import() from inside
    // node_modules. Unless Vite processes that module, the import runs
    // natively and cannot resolve "./x.js" specifiers to ".ts" sources.
    server: { deps: { inline: ["@fastify/autoload"] } },
  },
});
