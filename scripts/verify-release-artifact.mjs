import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const artifactRoot = path.resolve(workspaceRoot, process.env.REPLAY_ARTIFACT_DIR?.trim() || "dist");
const evidenceFilename = "release-evidence.json";
const deploymentControlPaths = new Set([".nojekyll"]);
const exactArtifactSha256 = new Map([
  [
    "licenses/inter-OFL-1.1.txt",
    "3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345",
  ],
  [
    "licenses/noto-sans-Apache-2.0.txt",
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  ],
]);

function fail(message) {
  throw new Error(`Release artifact verification failed: ${message}`);
}

const supportedArguments = new Set(["--require-clean-tree"]);
for (const argument of process.argv.slice(2)) {
  if (!supportedArguments.has(argument)) fail(`unsupported argument ${argument}`);
}
const requireCleanTreeFromCli = process.argv.includes("--require-clean-tree");

if (artifactRoot === workspaceRoot || artifactRoot === path.parse(artifactRoot).root) {
  fail("REPLAY_ARTIFACT_DIR must identify a dedicated build-output directory");
}

function normalizeBasePath(value) {
  const normalized = (value || "/").trim();
  const segments = normalized.split("/");
  if (
    !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(normalized) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    fail("REPLAY_EXPECT_BASE_PATH must be an absolute URL-safe path ending with '/'.");
  }
  return normalized;
}

const expectedBasePath = normalizeBasePath(
  process.env.REPLAY_EXPECT_BASE_PATH || process.env.VITE_BASE_PATH,
);

function decodeHtmlAttribute(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([a-f\d]+);/gi, (_match, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );
}

function parseHtmlAttributes(tag) {
  const attributes = new Map();
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1].toLowerCase(), decodeHtmlAttribute(match[2] ?? match[3] ?? ""));
  }
  return attributes;
}

function requireUniqueHtmlAttribute(source, tagName, predicate, attributeName, label) {
  const tags = [...source.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))]
    .map((match) => parseHtmlAttributes(match[0]))
    .filter(predicate);
  if (tags.length === 0) fail(`${label} is missing`);
  if (tags.length > 1) fail(`${label} must appear exactly once`);
  const value = tags[0].get(attributeName);
  if (!value) fail(`${label} has no ${attributeName} value`);
  return value;
}

function parseProductionUrl(value, label, { directory = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be a valid absolute URL (${String(value)})`);
  }
  if (url.protocol !== "https:") fail(`${label} must use HTTPS (${url.href})`);
  if (url.username || url.password || url.search || url.hash) {
    fail(`${label} must not contain credentials, a query, or a fragment (${url.href})`);
  }
  if (directory && !url.pathname.endsWith("/")) {
    fail(`${label} must end with '/' so the production base is unambiguous (${url.href})`);
  }
  return url;
}

function assertExactUrl(actualValue, expectedUrl, label) {
  const actualUrl = parseProductionUrl(actualValue, label);
  if (actualUrl.href !== expectedUrl.href) {
    fail(`${label} is ${actualUrl.href}; expected ${expectedUrl.href}`);
  }
  return actualUrl;
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(prefix, entry.name);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) fail(`symbolic links are not allowed (${relativePath})`);
    if (stats.isDirectory()) files.push(...(await listFiles(absolutePath, relativePath)));
    else if (stats.isFile()) files.push(relativePath);
    else fail(`unsupported artifact entry (${relativePath})`);
  }
  return files;
}

async function requireArtifact(relativePath) {
  const absolutePath = path.resolve(artifactRoot, relativePath);
  const artifactPrefix = `${artifactRoot}${path.sep}`;
  if (!absolutePath.startsWith(artifactPrefix)) fail(`path escaped dist (${relativePath})`);
  try {
    const stats = await lstat(absolutePath);
    if (!stats.isFile() || stats.isSymbolicLink()) fail(`${relativePath} is not a regular file`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Release artifact verification failed:")
    ) {
      throw error;
    }
    fail(`required file is missing (${relativePath})`);
  }
  return absolutePath;
}

function localArtifactPath(reference, sourcePath) {
  if (
    !reference ||
    reference.startsWith("#") ||
    reference.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(reference)
  ) {
    return undefined;
  }
  const resolved = new URL(reference, `https://release.invalid${expectedBasePath}${sourcePath}`);
  if (!resolved.pathname.startsWith(expectedBasePath)) {
    fail(`${sourcePath} references a path outside ${expectedBasePath} (${reference})`);
  }
  const encodedPath = resolved.pathname.slice(expectedBasePath.length);
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    fail(`${sourcePath} contains an invalid encoded reference (${reference})`);
  }
}

function gitOutput(args) {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

const requiredFiles = [
  ".nojekyll",
  "404.html",
  "_headers",
  "_redirects",
  "assets/generated/replay-hero-640.webp",
  "assets/generated/replay-hero-1200.webp",
  "assets/generated/replay-hero.webp",
  "favicon.svg",
  "index.html",
  "licenses/inter-OFL-1.1.txt",
  "licenses/noto-sans-Apache-2.0.txt",
  "robots.txt",
  "site.webmanifest",
  "sitemap.xml",
];
for (const relativePath of requiredFiles) await requireArtifact(relativePath);
for (const [relativePath, expectedSha256] of exactArtifactSha256) {
  const contents = await readFile(path.join(artifactRoot, relativePath));
  const actualSha256 = createHash("sha256").update(contents).digest("hex");
  if (actualSha256 !== expectedSha256) {
    fail(`${relativePath} does not match the approved upstream license`);
  }
}

const indexHtml = await readFile(path.join(artifactRoot, "index.html"), "utf8");
const decodedIndexHtml = indexHtml.replace(/&#(?:39|x27);/gi, "'");
const notFoundHtml = await readFile(path.join(artifactRoot, "404.html"), "utf8");
const headers = await readFile(path.join(artifactRoot, "_headers"), "utf8");
const redirects = await readFile(path.join(artifactRoot, "_redirects"), "utf8");
const robots = await readFile(path.join(artifactRoot, "robots.txt"), "utf8");
const sitemapXml = await readFile(path.join(artifactRoot, "sitemap.xml"), "utf8");
let packageMetadata;
try {
  packageMetadata = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
} catch {
  fail("package.json is not valid JSON");
}
const productionUrl = parseProductionUrl(packageMetadata?.homepage, "package.json homepage", {
  directory: true,
});
const unresolvedTokens = ["%BASE_URL%", "data-replay-base-path"];
for (const token of unresolvedTokens) {
  if (indexHtml.includes(token) || notFoundHtml.includes(token)) {
    fail(`unresolved build token ${token}`);
  }
}
if (indexHtml.includes("/src/main.tsx")) fail("index.html still references the source entrypoint");
if (!notFoundHtml.includes(`href="${expectedBasePath}"`)) {
  fail(`404.html does not return to the configured base path ${expectedBasePath}`);
}
if (redirects.trim() !== "/* /index.html 200") fail("_redirects is not the expected SPA fallback");

const requiredCspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
];
if (!indexHtml.includes('http-equiv="Content-Security-Policy"')) {
  fail("index.html has no CSP meta policy");
}
if (!indexHtml.includes('name="referrer" content="no-referrer"')) {
  fail("index.html has no no-referrer fallback policy");
}
for (const directive of requiredCspDirectives) {
  if (!decodedIndexHtml.includes(directive)) fail(`index CSP is missing ${directive}`);
  if (!headers.includes(directive)) fail(`response CSP is missing ${directive}`);
}
const requiredResponsePolicies = [
  "frame-ancestors 'none'",
  "Referrer-Policy: no-referrer",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: DENY",
  "Permissions-Policy: tools=(self)",
  "Cross-Origin-Opener-Policy: same-origin",
  "Cross-Origin-Embedder-Policy: require-corp",
  "Cross-Origin-Resource-Policy: same-origin",
  "Origin-Agent-Cluster: ?1",
];
for (const policy of requiredResponsePolicies) {
  if (!headers.includes(policy)) fail(`_headers is missing ${policy}`);
}

const canonicalUrl = requireUniqueHtmlAttribute(
  indexHtml,
  "link",
  (attributes) => (attributes.get("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"),
  "href",
  "index.html canonical URL",
);
assertExactUrl(canonicalUrl, productionUrl, "index.html canonical URL");

const openGraphUrl = requireUniqueHtmlAttribute(
  indexHtml,
  "meta",
  (attributes) => attributes.get("property")?.toLowerCase() === "og:url",
  "content",
  "index.html og:url",
);
assertExactUrl(openGraphUrl, productionUrl, "index.html og:url");

const openGraphImage = requireUniqueHtmlAttribute(
  indexHtml,
  "meta",
  (attributes) => attributes.get("property")?.toLowerCase() === "og:image",
  "content",
  "index.html og:image",
);
const openGraphImageUrl = parseProductionUrl(openGraphImage, "index.html og:image");
if (openGraphImageUrl.origin !== productionUrl.origin) {
  fail(
    `index.html og:image uses ${openGraphImageUrl.origin}; expected production origin ${productionUrl.origin}`,
  );
}
if (
  !openGraphImageUrl.pathname.startsWith(productionUrl.pathname) ||
  openGraphImageUrl.pathname === productionUrl.pathname
) {
  fail(
    `index.html og:image path ${openGraphImageUrl.pathname} must name an artifact below production base ${productionUrl.pathname}`,
  );
}
let openGraphImageArtifactPath;
try {
  openGraphImageArtifactPath = decodeURIComponent(
    openGraphImageUrl.pathname.slice(productionUrl.pathname.length),
  );
} catch {
  fail(`index.html og:image contains invalid path encoding (${openGraphImage})`);
}
await requireArtifact(openGraphImageArtifactPath);

const sitemapLocations = [...sitemapXml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) =>
  decodeHtmlAttribute(match[1].trim()),
);
if (sitemapLocations.length === 0) fail("sitemap.xml contains no <loc> URL");
let sitemapContainsProductionPage = false;
for (const location of sitemapLocations) {
  const sitemapUrl = parseProductionUrl(location, "sitemap.xml <loc>");
  if (
    sitemapUrl.origin !== productionUrl.origin ||
    !sitemapUrl.pathname.startsWith(productionUrl.pathname)
  ) {
    fail(`sitemap.xml <loc> ${sitemapUrl.href} is outside production base ${productionUrl.href}`);
  }
  if (sitemapUrl.href === productionUrl.href) sitemapContainsProductionPage = true;
}
if (!sitemapContainsProductionPage) {
  fail(`sitemap.xml has no <loc> for the canonical production URL ${productionUrl.href}`);
}

const robotsSitemapUrls = robots
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => /^sitemap:\s*(\S+)\s*$/i.exec(line)?.[1])
  .filter((value) => value !== undefined);
if (robotsSitemapUrls.length === 0) fail("robots.txt has no Sitemap URL");
if (robotsSitemapUrls.length > 1) fail("robots.txt must declare exactly one Sitemap URL");
const expectedSitemapUrl = new URL("sitemap.xml", productionUrl);
assertExactUrl(robotsSitemapUrls[0], expectedSitemapUrl, "robots.txt Sitemap URL");

const attributeReferences = [...indexHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(
  (match) => match[1],
);
for (const reference of attributeReferences) {
  const relativePath = localArtifactPath(reference, "index.html");
  if (relativePath) await requireArtifact(relativePath);
}

let webManifest;
try {
  webManifest = JSON.parse(await readFile(path.join(artifactRoot, "site.webmanifest"), "utf8"));
} catch {
  fail("site.webmanifest is not valid JSON");
}
if (webManifest.start_url !== "./") fail("site.webmanifest start_url must remain base-relative");
if (!Array.isArray(webManifest.icons) || webManifest.icons.length === 0) {
  fail("site.webmanifest has no icon");
}
for (const icon of webManifest.icons) {
  if (typeof icon?.src !== "string") fail("site.webmanifest contains an invalid icon source");
  const relativePath = localArtifactPath(icon.src, "site.webmanifest");
  if (!relativePath) fail(`manifest icon must be same-origin (${icon.src})`);
  await requireArtifact(relativePath);
}

const artifactFiles = (await listFiles(artifactRoot)).filter(
  (relativePath) => relativePath !== evidenceFilename,
);
if (!artifactFiles.some((relativePath) => /^assets\/.*\.js$/.test(relativePath))) {
  fail("artifact contains no compiled JavaScript bundle");
}
if (!artifactFiles.some((relativePath) => /^assets\/.*\.css$/.test(relativePath))) {
  fail("artifact contains no compiled stylesheet");
}
for (const relativePath of artifactFiles) {
  if (/\.(?:map|ts|tsx|jsx)$/i.test(relativePath)) {
    fail(`source or source-map file leaked into the artifact (${relativePath})`);
  }
}

const deploymentControlFiles = [];
const payloadFiles = [];
let payloadBytes = 0;
for (const relativePath of artifactFiles) {
  const contents = await readFile(path.join(artifactRoot, relativePath));
  const fileEvidence = {
    path: relativePath,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  if (deploymentControlPaths.has(relativePath)) {
    deploymentControlFiles.push(fileEvidence);
    continue;
  }
  payloadBytes += contents.byteLength;
  payloadFiles.push(fileEvidence);
}

const expectedSourceCommit = process.env.REPLAY_SOURCE_COMMIT?.trim();
const checkedOutCommit = gitOutput(["rev-parse", "HEAD"]);
if (expectedSourceCommit && checkedOutCommit && expectedSourceCommit !== checkedOutCommit) {
  fail("REPLAY_SOURCE_COMMIT does not match the checked-out source");
}
const sourceCommit = expectedSourceCommit || checkedOutCommit || "";
if (!/^[a-f\d]{40}$/i.test(sourceCommit)) fail("source commit is unavailable or invalid");
const treeStatus = gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]);
const sourceTreeClean = treeStatus === "";
if (
  requireCleanTreeFromCli ||
  ["1", "true"].includes(process.env.REPLAY_REQUIRE_CLEAN_TREE?.toLowerCase() || "")
) {
  if (treeStatus === undefined) fail("the source tree cleanliness could not be verified");
  if (!sourceTreeClean) fail("the source tree is not clean");
}
const packageLock = await readFile(path.join(workspaceRoot, "package-lock.json"));
const payloadManifestSha256 = createHash("sha256")
  .update(payloadFiles.map((file) => `${file.sha256}  ${file.path}\n`).join(""))
  .digest("hex");
const releaseEvidence = {
  schemaVersion: 1,
  source: {
    commit: sourceCommit,
    treeClean: sourceTreeClean,
    node: process.version,
    packageManager: process.env.npm_config_user_agent?.split(" ")[0] || "unknown",
    packageLockSha256: createHash("sha256").update(packageLock).digest("hex"),
  },
  artifact: {
    basePath: expectedBasePath,
    deploymentControlFileCount: deploymentControlFiles.length,
    deploymentControlFiles,
    payloadFileCount: payloadFiles.length,
    payloadBytes,
    payloadManifestSha256,
    payloadFiles,
  },
};
await writeFile(
  path.join(artifactRoot, evidenceFilename),
  `${JSON.stringify(releaseEvidence, null, 2)}\n`,
  "utf8",
);
const githubOutputPath = process.env.GITHUB_OUTPUT?.trim();
if (githubOutputPath) {
  await appendFile(githubOutputPath, `payload_manifest_sha256=${payloadManifestSha256}\n`, "utf8");
}

console.log(
  `Verified ${String(payloadFiles.length)} public payload files (${String(payloadBytes)} bytes) and ${String(deploymentControlFiles.length)} deployment control file for ${expectedBasePath}; wrote ${evidenceFilename}.`,
);
