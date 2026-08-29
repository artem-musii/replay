import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.REPLAY_E2E_PORT ?? 4173);
if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65_535) {
  throw new Error("REPLAY_E2E_PORT must be an integer between 1024 and 65535.");
}

function configuredBasePath(value = "/"): string {
  const normalized = value.trim();
  const segments = normalized.split("/");
  if (
    !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(normalized) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "REPLAY_E2E_BASE_PATH must be an absolute URL-safe path that starts and ends with '/'.",
    );
  }
  return normalized;
}

const e2eBasePath = configuredBasePath(
  process.env.REPLAY_E2E_BASE_PATH ?? process.env.VITE_BASE_PATH,
);
const skipBuild = process.env.REPLAY_E2E_SKIP_BUILD === "true";
const e2eOrigin = `http://127.0.0.1:${String(e2ePort)}`;
const viteBaseEnvironment = e2eBasePath === "/" ? "" : `VITE_BASE_PATH=${e2eBasePath} `;
const releaseSmoke = /release-smoke\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `${e2eOrigin}${e2eBasePath}`,
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
    {
      name: "firefox-smoke",
      testMatch: releaseSmoke,
      use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "webkit-smoke",
      testMatch: releaseSmoke,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `${skipBuild ? "" : `${viteBaseEnvironment}npm run build && `}${viteBaseEnvironment}npm run preview -- --host 127.0.0.1 --port ${String(e2ePort)}`,
    url: `${e2eOrigin}${e2eBasePath}`,
    reuseExistingServer: !process.env.CI && !skipBuild && e2eBasePath === "/",
    timeout: 180_000,
  },
});
