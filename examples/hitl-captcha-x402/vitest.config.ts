import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "hitl-captcha-x402",
    environment: "node",
    retry: 3,
    include: ["src/**/*.test.ts"]
  }
});