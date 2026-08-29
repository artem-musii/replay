// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();
const verifierPath = path.join(workspaceRoot, "scripts/verify-release-artifact.mjs");
const checkedOutCommit = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: workspaceRoot,
  encoding: "utf8",
});
const sourceCommit =
  checkedOutCommit.status === 0 && /^[a-f\d]{40}$/i.test(checkedOutCommit.stdout.trim())
    ? checkedOutCommit.stdout.trim()
    : "0000000000000000000000000000000000000001";
const packageMetadata = JSON.parse(
  await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
) as { homepage: string };
const productionUrl = new URL(packageMetadata.homepage);
const productionSitemapUrl = new URL("sitemap.xml", productionUrl).href;
const productionImageUrl = new URL("assets/generated/replay-hero.webp", productionUrl).href;

let artifactRoot = "";

function indexHtml(
  basePath: string,
  overrides: Partial<{ canonical: string; openGraphUrl: string; openGraphImage: string }> = {},
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; script-src 'self'; connect-src 'self'" />
    <meta name="referrer" content="no-referrer" />
    <meta property="og:url" content="${overrides.openGraphUrl ?? productionUrl.href}" />
    <meta property="og:image" content="${overrides.openGraphImage ?? productionImageUrl}" />
    <link rel="canonical" href="${overrides.canonical ?? productionUrl.href}" />
    <link rel="icon" href="${basePath}favicon.svg" />
    <link rel="manifest" href="${basePath}site.webmanifest" />
    <link rel="stylesheet" href="${basePath}assets/app.css" />
    <script type="module" src="${basePath}assets/app.js"></script>
  </head>
  <body></body>
</html>
`;
}

async function writeArtifact(basePath: string): Promise<void> {
  await mkdir(path.join(artifactRoot, "assets/generated"), { recursive: true });
  await mkdir(path.join(artifactRoot, "licenses"), { recursive: true });
  const [responseHeaders, interLicense, notoSansLicense] = await Promise.all([
    readFile(path.join(workspaceRoot, "public/_headers")),
    readFile(path.join(workspaceRoot, "public/licenses/inter-OFL-1.1.txt")),
    readFile(path.join(workspaceRoot, "public/licenses/noto-sans-Apache-2.0.txt")),
  ]);
  await Promise.all([
    writeFile(path.join(artifactRoot, ".nojekyll"), ""),
    writeFile(path.join(artifactRoot, "404.html"), `<a href="${basePath}">Return</a>\n`),
    writeFile(path.join(artifactRoot, "_headers"), responseHeaders),
    writeFile(path.join(artifactRoot, "_redirects"), "/* /index.html 200\n"),
    writeFile(path.join(artifactRoot, "assets/app.css"), "body { color: black; }\n"),
    writeFile(path.join(artifactRoot, "assets/app.js"), "export {};\n"),
    writeFile(path.join(artifactRoot, "assets/generated/replay-hero-640.webp"), "small-image"),
    writeFile(path.join(artifactRoot, "assets/generated/replay-hero-1200.webp"), "medium-image"),
    writeFile(path.join(artifactRoot, "assets/generated/replay-hero.webp"), "test-image"),
    writeFile(
      path.join(artifactRoot, "favicon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    ),
    writeFile(path.join(artifactRoot, "index.html"), indexHtml(basePath)),
    writeFile(path.join(artifactRoot, "licenses/inter-OFL-1.1.txt"), interLicense),
    writeFile(path.join(artifactRoot, "licenses/noto-sans-Apache-2.0.txt"), notoSansLicense),
    writeFile(
      path.join(artifactRoot, "robots.txt"),
      `User-agent: *\nAllow: /\nSitemap: ${productionSitemapUrl}\n`,
    ),
    writeFile(
      path.join(artifactRoot, "site.webmanifest"),
      `${JSON.stringify({ start_url: "./", icons: [{ src: "favicon.svg" }] })}\n`,
    ),
    writeFile(
      path.join(artifactRoot, "sitemap.xml"),
      `<?xml version="1.0"?><urlset><url><loc>${productionUrl.href}</loc></url></urlset>\n`,
    ),
  ]);
}

function verifyArtifact(basePath = "/replay/") {
  return spawnSync(process.execPath, [verifierPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      REPLAY_ARTIFACT_DIR: artifactRoot,
      REPLAY_EXPECT_BASE_PATH: basePath,
      REPLAY_SOURCE_COMMIT: sourceCommit,
    },
  });
}

describe("release artifact production metadata verification", () => {
  beforeEach(async () => {
    artifactRoot = await mkdtemp(path.join(os.tmpdir(), "replay-release-artifact-"));
    await writeArtifact("/replay/");
  });

  afterEach(async () => {
    await rm(artifactRoot, { recursive: true, force: true });
  });

  it.each(["/", "/replay/"])(
    "accepts coherent production metadata for a %s build",
    async (basePath) => {
      await writeArtifact(basePath);

      const result = verifyArtifact(basePath);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const evidence = JSON.parse(
        await readFile(path.join(artifactRoot, "release-evidence.json"), "utf8"),
      ) as {
        artifact: {
          basePath: string;
          deploymentControlFileCount: number;
          deploymentControlFiles: Array<{ bytes: number; path: string; sha256: string }>;
          payloadFiles: Array<{ path: string }>;
        };
      };
      expect(evidence.artifact.basePath).toBe(basePath);
      expect(evidence.artifact.deploymentControlFileCount).toBe(1);
      expect(evidence.artifact.deploymentControlFiles).toEqual([
        {
          bytes: 0,
          path: ".nojekyll",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      ]);
      expect(evidence.artifact.payloadFiles).not.toContainEqual(
        expect.objectContaining({ path: ".nojekyll" }),
      );
      expect(evidence.artifact.payloadFiles).toContainEqual(
        expect.objectContaining({ path: "licenses/inter-OFL-1.1.txt" }),
      );
      expect(evidence.artifact.payloadFiles).toContainEqual(
        expect.objectContaining({ path: "licenses/noto-sans-Apache-2.0.txt" }),
      );
    },
  );

  it("still requires the local GitHub Pages control file", async () => {
    await rm(path.join(artifactRoot, ".nojekyll"));

    const result = verifyArtifact();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Release artifact verification failed: required file is missing (.nojekyll)",
    );
  });

  it("requires the Inter font redistribution license", async () => {
    await rm(path.join(artifactRoot, "licenses/inter-OFL-1.1.txt"));

    const result = verifyArtifact();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Release artifact verification failed: required file is missing (licenses/inter-OFL-1.1.txt)",
    );
  });

  it("rejects a modified Inter font license", async () => {
    await writeFile(path.join(artifactRoot, "licenses/inter-OFL-1.1.txt"), "modified\n");

    const result = verifyArtifact();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Release artifact verification failed: licenses/inter-OFL-1.1.txt does not match the approved upstream license",
    );
  });

  it("requires the Noto Sans redistribution license", async () => {
    await rm(path.join(artifactRoot, "licenses/noto-sans-Apache-2.0.txt"));

    const result = verifyArtifact();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Release artifact verification failed: required file is missing (licenses/noto-sans-Apache-2.0.txt)",
    );
  });

  it("rejects a modified Noto Sans license", async () => {
    await writeFile(path.join(artifactRoot, "licenses/noto-sans-Apache-2.0.txt"), "modified\n");

    const result = verifyArtifact();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Release artifact verification failed: licenses/noto-sans-Apache-2.0.txt does not match the approved upstream license",
    );
  });

  it.each(["replay-hero-640.webp", "replay-hero-1200.webp"])(
    "rejects an artifact missing required responsive asset %s",
    async (filename) => {
      await rm(path.join(artifactRoot, "assets/generated", filename));

      const result = verifyArtifact();

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        `Release artifact verification failed: required file is missing (assets/generated/${filename})`,
      );
    },
  );

  it.each([
    {
      label: "canonical URL",
      change: async () =>
        writeFile(
          path.join(artifactRoot, "index.html"),
          indexHtml("/replay/", { canonical: new URL("wrong/", productionUrl).href }),
        ),
      expected: "index.html canonical URL is",
    },
    {
      label: "Open Graph URL",
      change: async () =>
        writeFile(
          path.join(artifactRoot, "index.html"),
          indexHtml("/replay/", { openGraphUrl: new URL("wrong/", productionUrl).href }),
        ),
      expected: "index.html og:url is",
    },
    {
      label: "Open Graph image origin",
      change: async () =>
        writeFile(
          path.join(artifactRoot, "index.html"),
          indexHtml("/replay/", {
            openGraphImage: "https://cdn.example.invalid/replay-hero.webp",
          }),
        ),
      expected: "index.html og:image uses https://cdn.example.invalid",
    },
    {
      label: "Open Graph image base path",
      change: async () =>
        writeFile(
          path.join(artifactRoot, "index.html"),
          indexHtml("/replay/", {
            openGraphImage: new URL("/outside/replay-hero.webp", productionUrl).href,
          }),
        ),
      expected: "index.html og:image path /outside/replay-hero.webp",
    },
    {
      label: "sitemap location",
      change: async () =>
        writeFile(
          path.join(artifactRoot, "sitemap.xml"),
          '<?xml version="1.0"?><urlset><url><loc>https://example.invalid/</loc></url></urlset>\n',
        ),
      expected: "sitemap.xml <loc> https://example.invalid/ is outside production base",
    },
    {
      label: "robots Sitemap URL",
      change: async () =>
        writeFile(
          path.join(artifactRoot, "robots.txt"),
          `User-agent: *\nSitemap: ${new URL("wrong-sitemap.xml", productionUrl).href}\n`,
        ),
      expected: "robots.txt Sitemap URL is",
    },
  ])("rejects drift in the $label", async ({ change, expected }) => {
    await change();

    const result = verifyArtifact();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Release artifact verification failed: ${expected}`);
  });
});
