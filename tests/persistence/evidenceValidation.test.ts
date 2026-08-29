import { describe, expect, it } from "vitest";

import {
  detectSupportedEvidenceMimeType,
  EVIDENCE_IMAGE_TOO_LARGE_MESSAGE,
  MAX_EVIDENCE_IMAGE_PIXELS,
  validateEvidenceImageDimensions,
  validateEvidenceImageSignature,
} from "../../src/persistence/evidenceValidation";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  ]);
}

function webpHeader(kind: "VP8X" | "VP8 " | "VP8L", width: number, height: number): Uint8Array {
  const byteLength = kind === "VP8L" ? 26 : 30;
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set(new TextEncoder().encode(kind), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, byteLength - 8, true);
  if (kind === "VP8X") {
    view.setUint32(16, 10, true);
    const widthMinusOne = width - 1;
    const heightMinusOne = height - 1;
    bytes.set(
      [
        widthMinusOne & 0xff,
        (widthMinusOne >> 8) & 0xff,
        (widthMinusOne >> 16) & 0xff,
        heightMinusOne & 0xff,
        (heightMinusOne >> 8) & 0xff,
        (heightMinusOne >> 16) & 0xff,
      ],
      24,
    );
  } else if (kind === "VP8 ") {
    view.setUint32(16, 10, true);
    bytes.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  } else {
    view.setUint32(16, 5, true);
    bytes[20] = 0x2f;
    const packed = (width - 1) | ((height - 1) << 14);
    view.setUint32(21, packed, true);
  }
  return bytes;
}

describe("local evidence container validation", () => {
  it.each([
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10, 0]],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ] as const)("detects %s from bytes", (mimeType, values) => {
    expect(detectSupportedEvidenceMimeType(Uint8Array.from(values))).toBe(mimeType);
  });

  it("accepts a supported image when browser MIME metadata is absent", () => {
    expect(validateEvidenceImageSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1]), "")).toEqual({
      ok: true,
      mimeType: "image/jpeg",
    });
  });

  it("rejects unrecognized and MIME-mismatched bytes", () => {
    const disguisedSvg = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    expect(validateEvidenceImageSignature(disguisedSvg, "image/png")).toMatchObject({
      ok: false,
      message: expect.stringContaining("not a recognized"),
    });

    expect(
      validateEvidenceImageSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/png"),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("browser reported image/png"),
    });
  });

  it.each([
    ["PNG", pngHeader(640, 480), "image/png", 640, 480],
    ["JPEG", jpegHeader(1920, 1080), "image/jpeg", 1920, 1080],
    ["16 MP phone JPEG", jpegHeader(4608, 3456), "image/jpeg", 4608, 3456],
    ["extended WebP", webpHeader("VP8X", 2048, 1024), "image/webp", 2048, 1024],
    ["lossy WebP", webpHeader("VP8 ", 1280, 720), "image/webp", 1280, 720],
    ["lossless WebP", webpHeader("VP8L", 321, 654), "image/webp", 321, 654],
  ] as const)(
    "reads safe dimensions from %s before decode",
    (_label, bytes, mimeType, width, height) => {
      expect(validateEvidenceImageDimensions(bytes, mimeType)).toEqual({
        ok: true,
        width,
        height,
      });
    },
  );

  it("accepts the 16 megapixel boundary and documents the decoded-area limit", () => {
    expect(MAX_EVIDENCE_IMAGE_PIXELS).toBe(16_000_000);
    expect(validateEvidenceImageDimensions(pngHeader(4_000, 4_000), "image/png")).toEqual({
      ok: true,
      width: 4_000,
      height: 4_000,
    });
    expect(EVIDENCE_IMAGE_TOO_LARGE_MESSAGE).toContain("16 megapixels total");
  });

  it.each([
    [pngHeader(12_001, 1), "image/png"],
    [jpegHeader(4_001, 4_000), "image/jpeg"],
    [webpHeader("VP8X", 1, 12_001), "image/webp"],
  ] as const)("rejects hostile dimensions before browser decode", (bytes, mimeType) => {
    expect(validateEvidenceImageDimensions(bytes, mimeType)).toEqual({
      ok: false,
      message: EVIDENCE_IMAGE_TOO_LARGE_MESSAGE,
    });
  });

  it.each([
    [pngHeader(0, 480), "image/png"],
    [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
    [Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]), "image/jpeg"],
    [webpHeader("VP8 ", 640, 480).slice(0, 25), "image/webp"],
  ] as const)("rejects malformed or truncated dimension headers", (bytes, mimeType) => {
    expect(validateEvidenceImageDimensions(bytes, mimeType)).toEqual({
      ok: false,
      message: "This image header does not contain readable dimensions.",
    });
  });
});
