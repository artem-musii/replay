import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { TextDecoder, TextEncoder } from "node:util";

const evidenceFilename = "release-evidence.json";
const expectedDeploymentControlPaths = new Set([".nojekyll"]);
const maximumEvidenceBytes = 2 * 1024 * 1024;
const maximumPayloadFileBytes = 25 * 1024 * 1024;
const maximumPayloadBytes = 250 * 1024 * 1024;
const maximumParallelFetches = 8;
const requestTimeoutMs = 15_000;
const attemptTimeoutMs = 30_000;
const retryDelaysMs = [0, 2_000, 5_000, 10_000, 15_000, 20_000, 30_000, 45_000];

function fail(message) {
  throw new Error(`Deployed release verification failed: ${message}`);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  if (["1", "true"].includes(value.trim().toLowerCase())) return true;
  if (["0", "false"].includes(value.trim().toLowerCase())) return false;
  fail("boolean environment values must be true/false or 1/0");
}

function parseAttemptCount(value) {
  if (value === undefined || value.trim() === "") return retryDelaysMs.length;
  const attempts = Number(value);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > retryDelaysMs.length) {
    fail(
      `REPLAY_DEPLOY_VERIFY_ATTEMPTS must be an integer from 1 to ${String(retryDelaysMs.length)}`,
    );
  }
  return attempts;
}

function isLoopbackHostname(hostname) {
  return ["127.0.0.1", "localhost", "[::1]"].includes(hostname.toLowerCase());
}

function normalizeDeploymentUrl(value) {
  if (!value?.trim()) fail("REPLAY_DEPLOYED_URL is required");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    fail("REPLAY_DEPLOYED_URL must be a valid absolute URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    fail("REPLAY_DEPLOYED_URL must not contain credentials, a query, or a fragment");
  }
  const loopbackHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    fail("REPLAY_DEPLOYED_URL must use HTTPS, except for an explicit loopback test URL");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function validatePayloadPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(`release evidence contains an unsafe payload path (${String(value)})`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const deploymentUrl = normalizeDeploymentUrl(process.env.REPLAY_DEPLOYED_URL);
const isLoopbackDeployment = isLoopbackHostname(deploymentUrl.hostname);
const expectedCommit = process.env.REPLAY_DEPLOYED_COMMIT?.trim();
if (expectedCommit && !/^[a-f\d]{40}$/i.test(expectedCommit)) {
  fail("REPLAY_DEPLOYED_COMMIT must be a full 40-character commit SHA");
}
if (!isLoopbackDeployment && !expectedCommit) {
  fail("REPLAY_DEPLOYED_COMMIT is required for a remote deployment check");
}
const expectedPayloadManifestSha256 = process.env.REPLAY_EXPECT_PAYLOAD_MANIFEST_SHA256?.trim();
if (expectedPayloadManifestSha256 && !/^[a-f\d]{64}$/i.test(expectedPayloadManifestSha256)) {
  fail("REPLAY_EXPECT_PAYLOAD_MANIFEST_SHA256 must be a 64-character SHA-256");
}
if (!isLoopbackDeployment && !expectedPayloadManifestSha256) {
  fail("REPLAY_EXPECT_PAYLOAD_MANIFEST_SHA256 is required for a remote deployment check");
}
const requireCleanTree = parseBoolean(process.env.REPLAY_DEPLOY_REQUIRE_CLEAN_TREE, true);
const maximumAttempts = parseAttemptCount(process.env.REPLAY_DEPLOY_VERIFY_ATTEMPTS);
const cacheKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function fetchBytes(relativePath, attempt, maximumBytes, attemptSignal) {
  const target = new URL(relativePath, deploymentUrl);
  if (
    target.origin !== deploymentUrl.origin ||
    !target.pathname.startsWith(deploymentUrl.pathname)
  ) {
    fail(`payload URL escaped the deployment base (${relativePath})`);
  }
  target.searchParams.set("replay-release-check", `${cacheKey}-${String(attempt)}`);
  const response = await globalThis.fetch(target, {
    cache: "no-store",
    redirect: "manual",
    signal: globalThis.AbortSignal.any([
      attemptSignal,
      globalThis.AbortSignal.timeout(requestTimeoutMs),
    ]),
    headers: { "accept-encoding": "identity" },
  });
  if (!response.ok) {
    fail(`${relativePath} returned HTTP ${String(response.status)}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    fail(`${relativePath} exceeds the ${String(maximumBytes)}-byte verification limit`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      fail(`${relativePath} exceeds the ${String(maximumBytes)}-byte verification limit`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function mapWithConcurrency(values, mapper, onFirstError) {
  const results = new Array(values.length);
  let nextIndex = 0;
  let firstError;
  async function worker() {
    while (nextIndex < values.length && firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index]);
      } catch (error) {
        if (firstError === undefined) {
          firstError = error;
          onFirstError();
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(maximumParallelFetches, values.length) }, () => worker()),
  );
  if (firstError !== undefined) throw firstError;
  return results;
}

async function verifyAttempt(attempt) {
  const attemptController = new globalThis.AbortController();
  const attemptSignal = globalThis.AbortSignal.any([
    attemptController.signal,
    globalThis.AbortSignal.timeout(attemptTimeoutMs),
  ]);
  try {
    return await verifyAttemptWithinDeadline(attempt, attemptController, attemptSignal);
  } finally {
    attemptController.abort();
  }
}

async function verifyAttemptWithinDeadline(attempt, attemptController, attemptSignal) {
  const evidenceBytes = await fetchBytes(
    evidenceFilename,
    attempt,
    maximumEvidenceBytes,
    attemptSignal,
  );
  let evidence;
  try {
    evidence = JSON.parse(new TextDecoder().decode(evidenceBytes));
  } catch {
    fail(`${evidenceFilename} is not valid JSON`);
  }
  if (evidence?.schemaVersion !== 1) fail("release evidence schemaVersion is not 1");
  if (evidence?.artifact?.basePath !== deploymentUrl.pathname) {
    fail(
      `release evidence base path is ${String(evidence?.artifact?.basePath)}, expected ${deploymentUrl.pathname}`,
    );
  }
  if (expectedCommit && evidence?.source?.commit !== expectedCommit) {
    fail(
      `release evidence identifies commit ${String(evidence?.source?.commit)}, expected ${expectedCommit}`,
    );
  }
  if (!/^[a-f\d]{40}$/i.test(evidence?.source?.commit ?? "")) {
    fail("release evidence contains an invalid source commit");
  }
  if (typeof evidence?.source?.treeClean !== "boolean") {
    fail("release evidence contains an invalid source tree state");
  }
  if (requireCleanTree && evidence?.source?.treeClean !== true) {
    fail("release evidence does not attest a clean source tree");
  }

  const deploymentControlFiles = evidence?.artifact?.deploymentControlFiles;
  if (
    !Array.isArray(deploymentControlFiles) ||
    deploymentControlFiles.length !== expectedDeploymentControlPaths.size ||
    evidence.artifact.deploymentControlFileCount !== deploymentControlFiles.length
  ) {
    fail("release evidence contains an invalid deployment control file list");
  }
  const seenControlPaths = new Set();
  for (const file of deploymentControlFiles) {
    const relativePath = validatePayloadPath(file?.path);
    if (
      !expectedDeploymentControlPaths.has(relativePath) ||
      seenControlPaths.has(relativePath) ||
      !Number.isSafeInteger(file?.bytes) ||
      file.bytes < 0 ||
      file.bytes > maximumPayloadFileBytes ||
      !/^[a-f\d]{64}$/i.test(file?.sha256 ?? "")
    ) {
      fail(`release evidence contains an invalid deployment control file (${relativePath})`);
    }
    seenControlPaths.add(relativePath);
  }

  const payloadFiles = evidence?.artifact?.payloadFiles;
  if (!Array.isArray(payloadFiles) || payloadFiles.length === 0 || payloadFiles.length > 1_000) {
    fail("release evidence contains an invalid payload file list");
  }
  if (evidence.artifact.payloadFileCount !== payloadFiles.length) {
    fail("release evidence payloadFileCount does not match its file list");
  }
  if (
    !Number.isSafeInteger(evidence.artifact.payloadBytes) ||
    evidence.artifact.payloadBytes < 1 ||
    evidence.artifact.payloadBytes > maximumPayloadBytes
  ) {
    fail("release evidence contains an invalid payload byte total");
  }
  if (!/^[a-f\d]{64}$/i.test(evidence.artifact.payloadManifestSha256 ?? "")) {
    fail("release evidence contains an invalid payload manifest SHA-256");
  }
  if (
    expectedPayloadManifestSha256 &&
    evidence.artifact.payloadManifestSha256 !== expectedPayloadManifestSha256
  ) {
    fail("release evidence payload manifest does not match the verified build artifact");
  }

  const seenPaths = new Set();
  const filesToVerify = [];
  let declaredPayloadBytes = 0;
  for (const file of payloadFiles) {
    const relativePath = validatePayloadPath(file?.path);
    if (
      relativePath === evidenceFilename ||
      expectedDeploymentControlPaths.has(relativePath) ||
      seenPaths.has(relativePath)
    ) {
      fail(`release evidence contains a duplicate or self-referential path (${relativePath})`);
    }
    seenPaths.add(relativePath);
    if (
      !Number.isSafeInteger(file?.bytes) ||
      file.bytes < 0 ||
      file.bytes > maximumPayloadFileBytes
    ) {
      fail(`release evidence contains an invalid byte count for ${relativePath}`);
    }
    if (!/^[a-f\d]{64}$/i.test(file?.sha256 ?? "")) {
      fail(`release evidence contains an invalid SHA-256 for ${relativePath}`);
    }
    declaredPayloadBytes += file.bytes;
    if (declaredPayloadBytes > maximumPayloadBytes) {
      fail("release evidence payload file sizes exceed the verification limit");
    }
    filesToVerify.push({ path: relativePath, bytes: file.bytes, sha256: file.sha256 });
  }
  if (declaredPayloadBytes !== evidence.artifact.payloadBytes) {
    fail("release evidence payload byte total does not match its file list");
  }

  const verifiedFiles = await mapWithConcurrency(
    filesToVerify,
    async (file) => {
      const relativePath = file.path;
      const bytes = await fetchBytes(relativePath, attempt, maximumPayloadFileBytes, attemptSignal);
      const actualSha256 = sha256(bytes);
      if (bytes.byteLength !== file.bytes) {
        fail(
          `${relativePath} has ${String(bytes.byteLength)} bytes, expected ${String(file.bytes)}`,
        );
      }
      if (actualSha256 !== file.sha256) {
        fail(`${relativePath} SHA-256 does not match the release evidence`);
      }
      return { path: relativePath, bytes: bytes.byteLength, sha256: actualSha256 };
    },
    () => attemptController.abort(),
  );

  verifiedFiles.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const payloadBytes = verifiedFiles.reduce((total, file) => total + file.bytes, 0);
  if (payloadBytes !== evidence.artifact.payloadBytes) {
    fail(
      `deployed payload has ${String(payloadBytes)} bytes, expected ${String(evidence.artifact.payloadBytes)}`,
    );
  }
  const manifestSha256 = sha256(
    new TextEncoder().encode(
      verifiedFiles.map((file) => `${file.sha256}  ${file.path}\n`).join(""),
    ),
  );
  if (manifestSha256 !== evidence.artifact.payloadManifestSha256) {
    fail("deployed payload manifest SHA-256 does not match the release evidence");
  }
  return {
    files: verifiedFiles.length,
    bytes: payloadBytes,
    manifestSha256,
    commit: evidence.source.commit,
  };
}

let lastError;
for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
  if (attempt > 1) await wait(retryDelaysMs[attempt - 1]);
  try {
    const result = await verifyAttempt(attempt);
    console.log(
      `Verified deployed commit ${result.commit}: ${String(result.files)} files, ${String(result.bytes)} bytes, manifest ${result.manifestSha256}.`,
    );
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    const message =
      error instanceof Error ? error.message : "Unknown deployment verification error.";
    console.warn(
      `Deployment verification attempt ${String(attempt)}/${String(maximumAttempts)} failed: ${message}`,
    );
  }
}

if (lastError) throw lastError;
