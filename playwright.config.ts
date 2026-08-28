import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.REPLAY_E2E_PORT ?? 4173);
if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65_535) {
  throw new Error("REPLAY_E2E_PORT must be an integer between 1024 and 65535.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(e2ePort)}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${String(e2ePort)}`,
    port: e2ePort,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
