import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { firstUnsupportedPdfGlyph, parseTrueTypeGlyphCoverage } from "../../src/export/pdfFonts";

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("bundled PDF font coverage", () => {
  it("reads real Latin and Cyrillic glyph coverage without claiming emoji or CJK", async () => {
    const bytes = await readFile(
      path.join(process.cwd(), "node_modules/notosans-fontface/fonts/NotoSans-Regular.ttf"),
    );
    const coverage = parseTrueTypeGlyphCoverage(asArrayBuffer(bytes));

    expect(coverage.has("A".codePointAt(0) ?? 0)).toBe(true);
    expect(coverage.has("Ж".codePointAt(0) ?? 0)).toBe(true);
    expect(coverage.has("😀".codePointAt(0) ?? 0)).toBe(false);
    expect(coverage.has("確".codePointAt(0) ?? 0)).toBe(false);
    expect(
      firstUnsupportedPdfGlyph([{ label: "test statement", text: "Путь 😀" }], coverage),
    ).toMatchObject({ label: "test statement", character: "😀", codePoint: 0x1f600 });
    expect(
      firstUnsupportedPdfGlyph([{ label: "unnormalized tab", text: "A\tB" }], coverage),
    ).toMatchObject({ label: "unnormalized tab", character: "\t", codePoint: 0x09 });
  });

  it("rejects truncated or non-font data instead of assuming coverage", () => {
    expect(() => parseTrueTypeGlyphCoverage(new Uint8Array([0, 1, 2, 3]).buffer)).toThrow(
      /truncated TrueType header/,
    );
  });
});
