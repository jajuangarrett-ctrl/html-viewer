import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 20000,
  use: { baseURL: "http://127.0.0.1:4176", headless: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "python3 -m http.server 4176 --bind 127.0.0.1",
    url: "http://127.0.0.1:4176/tests/browser/",
    reuseExistingServer: false,
  },
  reporter: [["list"], ["json", { outputFile: "tests/results.json" }]],
});
