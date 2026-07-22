import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // fake-indexeddb/auto provides indexedDB in the queue test
    include: ["lib/**/*.test.ts"],
  },
});
