import type { EvidenceAsset } from "../domain/models";

const GENERATED_DEMO_ASSET_PATH = /^assets\/generated\/[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp)$/;

type EvidenceSourceAsset = Pick<EvidenceAsset, "localBlobKey" | "syntheticDemoAsset">;

function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

/**
 * Resolves packaged demo imagery without trusting an evidence record as an
 * arbitrary URL. Persisted seed versions therefore keep their own asset path,
 * while uploaded evidence continues to use its runtime object URL.
 */
export function resolveEvidenceImageSource(
  asset: EvidenceSourceAsset,
  runtimeBlobUrl?: string,
  baseUrl = import.meta.env.BASE_URL,
): string | undefined {
  if (!asset.syntheticDemoAsset) return runtimeBlobUrl;

  const generatedPath = asset.localBlobKey.replace(/^\/+/, "");
  if (!GENERATED_DEMO_ASSET_PATH.test(generatedPath)) return undefined;

  return `${withTrailingSlash(baseUrl)}${generatedPath}`;
}
