// @vitest-environment node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();
const verifierPath = path.join(workspaceRoot, "scripts/verify-deployed-release.mjs");
const basePath = "/replay/";
const evidencePath = `${basePath}release-evidence.json`;
const deploymentControlPath = ".nojekyll";
const deployedControlPath = `${basePath}${deploymentControlPath}`;
const payloadPath = "assets/app.js";
const deployedPayloadPath = `${basePath}${payloadPath}`;
const expectedCommit = "a".repeat(40);
const staleCommit = "b".repeat(40);
const payloadBytes = Buffer.from("export const replay = true;\n");
const maximumEvidenceBytes = 2 * 1024 * 1024;
const maximumPayloadFileBytes = 25 * 1024 * 1024;

interface FixtureResponse {
  body: Buffer;
  headers?: Record<string, string>;
  status?: number;
}

interface ReleaseFixtureOptions {
  commit?: string;
  servedPayload?: Buffer;
}

interface VerificationResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

const responses = new Map<string, FixtureResponse>();
let server: Server | undefined;
let deployedUrl = "";

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function installReleaseFixture(options: ReleaseFixtureOptions = {}): string {
  const attestedPayloadSha256 = sha256(payloadBytes);
  const payloadManifestSha256 = sha256(`${attestedPayloadSha256}  ${payloadPath}\n`);
  const evidence = {
    schemaVersion: 1,
    source: {
      commit: options.commit ?? expectedCommit,
      treeClean: true,
    },
    artifact: {
      basePath,
      deploymentControlFileCount: 1,
      deploymentControlFiles: [
        {
          path: deploymentControlPath,
          bytes: 0,
          sha256: sha256(Buffer.alloc(0)),
        },
      ],
      payloadFileCount: 1,
      payloadBytes: payloadBytes.byteLength,
      payloadManifestSha256,
      payloadFiles: [
        {
          path: payloadPath,
          bytes: payloadBytes.byteLength,
          sha256: attestedPayloadSha256,
        },
      ],
    },
  };

  responses.set(evidencePath, { body: Buffer.from(JSON.stringify(evidence)) });
  responses.set(deployedPayloadPath, { body: options.servedPayload ?? payloadBytes });
  return payloadManifestSha256;
}

async function runVerifier(expectedManifestSha256: string): Promise<VerificationResult> {
  const child = spawn(process.execPath, [verifierPath], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      NO_COLOR: "1",
      REPLAY_DEPLOYED_COMMIT: expectedCommit,
      REPLAY_DEPLOYED_URL: deployedUrl,
      REPLAY_DEPLOY_REQUIRE_CLEAN_TREE: "true",
      REPLAY_DEPLOY_VERIFY_ATTEMPTS: "1",
      REPLAY_EXPECT_PAYLOAD_MANIFEST_SHA256: expectedManifestSha256,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return await new Promise<VerificationResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stderr, stdout });
    });
  });
}

describe("deployed release verification", () => {
  beforeEach(async () => {
    responses.clear();
    server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const fixture = responses.get(requestUrl.pathname);
      if (!fixture) {
        response.writeHead(404, { "content-length": "0" });
        response.end();
        return;
      }

      response.writeHead(fixture.status ?? 200, {
        "content-length": String(fixture.body.byteLength),
        "content-type": "application/octet-stream",
        ...fixture.headers,
      });
      response.end(fixture.body);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("The release fixture did not bind to a loopback TCP port.");
    }
    deployedUrl = `http://127.0.0.1:${String(address.port)}${basePath}`;
  });

  afterEach(async () => {
    if (!server) return;
    const closing = new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    server.closeAllConnections();
    await closing;
    server = undefined;
  });

  it("accepts a valid attested release", async () => {
    const manifestSha256 = installReleaseFixture();

    const result = await runVerifier(manifestSha256);

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "",
      stdout: `Verified deployed commit ${expectedCommit}: 1 files, ${String(payloadBytes.byteLength)} bytes, manifest ${manifestSha256}.\n`,
    });
  });

  it("does not fetch a deployment control file that GitHub Pages keeps private", async () => {
    const manifestSha256 = installReleaseFixture();
    responses.set(deployedControlPath, { body: Buffer.alloc(0), status: 404 });

    const result = await runVerifier(manifestSha256);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("rejects payload bytes that do not match the attested SHA-256", async () => {
    const corruptPayload = Buffer.from(payloadBytes);
    corruptPayload.writeUInt8(corruptPayload.readUInt8(0) ^ 0xff, 0);
    const manifestSha256 = installReleaseFixture({ servedPayload: corruptPayload });

    const result = await runVerifier(manifestSha256);

    expect(result.exitCode).not.toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain(
      `Deployed release verification failed: ${payloadPath} SHA-256 does not match the release evidence`,
    );
  });

  it("rejects redirects instead of following them", async () => {
    const manifestSha256 = installReleaseFixture();
    responses.set(deployedPayloadPath, {
      body: Buffer.alloc(0),
      headers: { location: `${basePath}redirected.js` },
      status: 302,
    });

    const result = await runVerifier(manifestSha256);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `Deployed release verification failed: ${payloadPath} returned HTTP 302`,
    );
  });

  it("rejects an oversized evidence response from its declared length", async () => {
    const manifestSha256 = installReleaseFixture();
    const evidenceResponse = responses.get(evidencePath);
    if (!evidenceResponse) throw new Error("The evidence fixture was not installed.");
    evidenceResponse.headers = {
      "content-length": String(maximumEvidenceBytes + 1),
    };

    const result = await runVerifier(manifestSha256);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `Deployed release verification failed: release-evidence.json exceeds the ${String(maximumEvidenceBytes)}-byte verification limit`,
    );
  });

  it("rejects an oversized payload response from its declared length", async () => {
    const manifestSha256 = installReleaseFixture();
    const payloadResponse = responses.get(deployedPayloadPath);
    if (!payloadResponse) throw new Error("The payload fixture was not installed.");
    payloadResponse.headers = {
      "content-length": String(maximumPayloadFileBytes + 1),
    };

    const result = await runVerifier(manifestSha256);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `Deployed release verification failed: ${payloadPath} exceeds the ${String(maximumPayloadFileBytes)}-byte verification limit`,
    );
  });

  it("rejects release evidence for a stale commit", async () => {
    const manifestSha256 = installReleaseFixture({ commit: staleCommit });

    const result = await runVerifier(manifestSha256);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      `Deployed release verification failed: release evidence identifies commit ${staleCommit}, expected ${expectedCommit}`,
    );
  });

  it("rejects a release whose manifest differs from the expected build artifact", async () => {
    installReleaseFixture();
    const expectedManifestSha256 = "c".repeat(64);

    const result = await runVerifier(expectedManifestSha256);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Deployed release verification failed: release evidence payload manifest does not match the verified build artifact",
    );
  });
});
