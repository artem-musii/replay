import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

import { describe, expect, it } from "vitest";

import { resolveEvidenceImageSource } from "../../src/components/evidenceSource";
import { createDemoCase } from "../../src/domain/seed";

const legacyDemoAssets = [
  {
    localBlobKey: "/assets/generated/demo-roundabout-wide.webp",
    sizeBytes: 239_890,
    checksum: "8d97209032313b37ffaf3a92142d4d254339c5d6ed19bd354888dae8c4c1b5ea",
  },
  {
    localBlobKey: "/assets/generated/demo-vehicle-a-damage.webp",
    sizeBytes: 136_452,
    checksum: "27da729bfd9efdf78931d15423ef17253aa4d681faec7c6aaa03f2a4b9d5f0e9",
  },
  {
    localBlobKey: "/assets/generated/demo-vehicle-b-damage.webp",
    sizeBytes: 154_638,
    checksum: "b527745e962d163610cac7f3f6c529b35b9df28f32613165e2165307565cdeac",
  },
  {
    localBlobKey: "/assets/generated/demo-road-condition.webp",
    sizeBytes: 389_932,
    checksum: "e2179643bfd0bc5ebb74247abb839b8d3bb1a635ad8620846fd525c7ea3c8cc5",
  },
] as const;

function generatedAssetBytes(localBlobKey: string): Buffer {
  const relativePath = localBlobKey.replace(/^\/+/, "");
  return readFileSync(resolve(cwd(), "public", relativePath));
}

describe("resolveEvidenceImageSource", () => {
  it("uses each persisted demo asset path across current and legacy seed versions", () => {
    const currentOverview = createDemoCase().evidence.find(
      (asset) => asset.id === "evidence-overview",
    );
    if (!currentOverview) throw new Error("Current overview evidence is missing");

    expect(resolveEvidenceImageSource(currentOverview, undefined, "/replay-sol/")).toBe(
      "/replay-sol/assets/generated/demo-roundabout-wide-v2.webp",
    );

    const savedVersionOneOverview = {
      ...currentOverview,
      localBlobKey: "/assets/generated/demo-roundabout-wide.webp",
    };
    expect(resolveEvidenceImageSource(savedVersionOneOverview, undefined, "/replay-sol")).toBe(
      "/replay-sol/assets/generated/demo-roundabout-wide.webp",
    );
  });

  it("keeps uploaded evidence on its runtime blob URL", () => {
    const runtimeBlobUrl = "blob:https://replay.test/21e8e236-e5d2-409f-9f7a-e448ef8b5fe6";
    expect(
      resolveEvidenceImageSource(
        {
          localBlobKey: "evidence:case-local:asset-local",
          syntheticDemoAsset: false,
        },
        runtimeBlobUrl,
        "/replay-sol/",
      ),
    ).toBe(runtimeBlobUrl);
  });

  it.each([
    "https://example.test/evidence.webp",
    "/assets/generated/../../private.webp",
    "/assets/generated/%2e%2e/private.webp",
    "/assets/elsewhere/demo.webp",
    "data:image/webp;base64,AAAA",
  ])("rejects an untrusted packaged asset path: %s", (localBlobKey) => {
    expect(
      resolveEvidenceImageSource(
        { localBlobKey, syntheticDemoAsset: true },
        "blob:https://replay.test/untrusted-fallback",
        "/replay-sol/",
      ),
    ).toBeUndefined();
  });
});

describe("packaged evidence asset integrity", () => {
  it("matches current seed byte sizes and SHA-256 checksums", () => {
    const assets = createDemoCase().evidence.filter((asset) => asset.syntheticDemoAsset);
    expect(assets).toHaveLength(4);

    for (const asset of assets) {
      const bytes = generatedAssetBytes(asset.localBlobKey);
      expect(bytes.byteLength, asset.localBlobKey).toBe(asset.sizeBytes);
      expect(createHash("sha256").update(bytes).digest("hex"), asset.localBlobKey).toBe(
        asset.checksum,
      );
    }
  });

  it("retains the version-one files with their original metadata", () => {
    for (const asset of legacyDemoAssets) {
      const bytes = generatedAssetBytes(asset.localBlobKey);
      expect(bytes.byteLength, asset.localBlobKey).toBe(asset.sizeBytes);
      expect(createHash("sha256").update(bytes).digest("hex"), asset.localBlobKey).toBe(
        asset.checksum,
      );
    }
  });
});
