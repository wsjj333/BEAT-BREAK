import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages 프로젝트 페이지: https://<id>.github.io/BEAT-BREAK/
  base: "/BEAT-BREAK/",
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
