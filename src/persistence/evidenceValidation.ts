import type { EvidenceAsset } from "../domain";

export type SupportedEvidenceMimeType = EvidenceAsset["mimeType"];

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export const MAX_EVIDENCE_IMAGE_DIMENSION = 12_000;
export const MAX_EVIDENCE_IMAGE_PIXELS = 16_000_000;
export const EVIDENCE_IMAGE_TOO_LARGE_MESSAGE =
  "This image is too large to inspect safely. Use an image no wider or taller than 12,000 pixels and no more than 16 megapixels total.";

export type EvidenceImageDimensionsResult =
  { ok: true; width: number; height: number } | { ok: false; message: string };

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/**
 * Detects only the inert raster formats REPLAY accepts. Browser-provided MIME
 * metadata is advisory and can be empty or spoofed, so local evidence is
 * classified from its container signature before it enters IndexedDB.
 */
export function detectSupportedEvidenceMimeType(
  bytes: Uint8Array,
): SupportedEvidenceMimeType | undefined {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export function validateEvidenceImageSignature(
  bytes: Uint8Array,
  declaredMimeType: string,
): { ok: true; mimeType: SupportedEvidenceMimeType } | { ok: false; message: string } {
  const detectedMimeType = detectSupportedEvidenceMimeType(bytes);
  if (!detectedMimeType) {
    return {
      ok: false,
      message: "This file is not a recognized JPEG, PNG, or WebP image.",
    };
  }
  if (declaredMimeType && declaredMimeType !== detectedMimeType) {
    return {
      ok: false,
      message: `The file contents are ${detectedMimeType}, but the browser reported ${declaredMimeType}. Export the image again before adding it as evidence.`,
    };
  }
  return { ok: true, mimeType: detectedMimeType };
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || !startsWith(bytes, PNG_SIGNATURE)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLength = view.getUint32(8, false);
  const isIhdr =
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (ihdrLength !== 13 || !isIhdr) return undefined;
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0x00 || marker === 0xd9 || marker === 0xda) {
      return undefined;
    }
    offset += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return undefined;
      return {
        height: ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0),
        width: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
      };
    }
    offset += segmentLength;
  }
  return undefined;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (
    bytes.length < 20 ||
    !startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) ||
    bytes[8] !== 0x57 ||
    bytes[9] !== 0x45 ||
    bytes[10] !== 0x42 ||
    bytes[11] !== 0x50
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  const chunkSize = view.getUint32(16, true);
  if (riffSize < 12 || riffSize + 8 > bytes.length || chunkSize + 20 > bytes.length) {
    return undefined;
  }
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunkType === "VP8X") {
    if (chunkSize < 10 || bytes.length < 30) return undefined;
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    };
  }
  if (chunkType === "VP8 ") {
    if (
      chunkSize < 10 ||
      bytes.length < 30 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) {
      return undefined;
    }
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunkType === "VP8L") {
    if (chunkSize < 5 || bytes.length < 25 || bytes[20] !== 0x2f) return undefined;
    const dimensions = view.getUint32(21, true);
    return {
      width: (dimensions & 0x3fff) + 1,
      height: ((dimensions >>> 14) & 0x3fff) + 1,
    };
  }
  return undefined;
}

/**
 * Reads raster dimensions from inert container headers before asking a browser
 * decoder to allocate image memory. Decode-time dimensions are still checked
 * by the caller because container metadata is untrusted.
 */
export function validateEvidenceImageDimensions(
  bytes: Uint8Array,
  mimeType: SupportedEvidenceMimeType,
): EvidenceImageDimensionsResult {
  const dimensions =
    mimeType === "image/png"
      ? readPngDimensions(bytes)
      : mimeType === "image/jpeg"
        ? readJpegDimensions(bytes)
        : readWebpDimensions(bytes);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { ok: false, message: "This image header does not contain readable dimensions." };
  }
  if (
    dimensions.width > MAX_EVIDENCE_IMAGE_DIMENSION ||
    dimensions.height > MAX_EVIDENCE_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_EVIDENCE_IMAGE_PIXELS
  ) {
    return { ok: false, message: EVIDENCE_IMAGE_TOO_LARGE_MESSAGE };
  }
  return { ok: true, ...dimensions };
}
