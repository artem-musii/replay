import notoSansBoldUrl from "notosans-fontface/fonts/NotoSans-Bold.ttf?url";
import notoSansRegularUrl from "notosans-fontface/fonts/NotoSans-Regular.ttf?url";
import notoSansLicenseUrl from "notosans-fontface/LICENSE.txt?url";

export const PDF_FONT_FAMILY = "Noto Sans";

const PDF_FONT_FETCH_TIMEOUT_MS = 10_000;
const MAX_PDF_FONT_BYTES = 2 * 1024 * 1024;
const MAX_CMAP_CODE_POINTS = 250_000;
const REQUIRED_FONT_CODE_POINTS = [0x20, 0x41, 0x61, 0x2014, 0x0416] as const;

interface PdfFontFile {
  filename: string;
  base64: string;
}

export interface PdfFontResources {
  family: typeof PDF_FONT_FAMILY;
  licenseUrl: string;
  regular: PdfFontFile;
  bold: PdfFontFile;
  supportedCodePoints: ReadonlySet<number>;
}

export interface PdfTextEntry {
  label: string;
  text: string;
}

export interface UnsupportedPdfGlyph {
  label: string;
  character: string;
  codePoint: number;
}

export class PdfUnsupportedGlyphError extends Error {
  readonly code = "PDF_UNSUPPORTED_GLYPH" as const;
  readonly field: string;
  readonly codePoint: number;

  constructor(glyph: UnsupportedPdfGlyph) {
    const codePointLabel = `U+${glyph.codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    const visibleCharacter = /^\s$/u.test(glyph.character)
      ? codePointLabel
      : `${JSON.stringify(glyph.character)} (${codePointLabel})`;
    super(
      `PDF export stopped because the bundled Noto Sans font cannot represent ${visibleCharacter} in ${glyph.label}. Export the structured case JSON or replace that character; REPLAY did not create a lossy PDF.`,
    );
    this.name = "PdfUnsupportedGlyphError";
    this.field = glyph.label;
    this.codePoint = glyph.codePoint;
  }
}

function requireBytes(view: DataView, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new Error(`The bundled PDF font has an invalid ${label} offset.`);
  }
  if (offset + length > view.byteLength) {
    throw new Error(`The bundled PDF font has a truncated ${label} table.`);
  }
}

function tableTag(view: DataView, offset: number): string {
  requireBytes(view, offset, 4, "table directory");
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function addFormat4Coverage(view: DataView, subtableOffset: number, coverage: Set<number>): void {
  requireBytes(view, subtableOffset, 16, "cmap format 4");
  const length = view.getUint16(subtableOffset + 2);
  requireBytes(view, subtableOffset, length, "cmap format 4");
  const subtableEnd = subtableOffset + length;
  const segmentCountX2 = view.getUint16(subtableOffset + 6);
  if (segmentCountX2 === 0 || segmentCountX2 % 2 !== 0) {
    throw new Error("The bundled PDF font has an invalid cmap format 4 segment count.");
  }
  const segmentCount = segmentCountX2 / 2;
  const endCodesOffset = subtableOffset + 14;
  const startCodesOffset = endCodesOffset + segmentCount * 2 + 2;
  const deltasOffset = startCodesOffset + segmentCount * 2;
  const rangeOffsetsOffset = deltasOffset + segmentCount * 2;
  requireBytes(view, rangeOffsetsOffset, segmentCount * 2, "cmap format 4 segments");

  for (let index = 0; index < segmentCount; index += 1) {
    const start = view.getUint16(startCodesOffset + index * 2);
    const end = view.getUint16(endCodesOffset + index * 2);
    const delta = view.getInt16(deltasOffset + index * 2);
    const rangeOffsetPosition = rangeOffsetsOffset + index * 2;
    const rangeOffset = view.getUint16(rangeOffsetPosition);
    if (start > end) {
      throw new Error("The bundled PDF font has an invalid cmap format 4 range.");
    }
    for (let codePoint = start; codePoint <= end && codePoint !== 0xffff; codePoint += 1) {
      let glyphId: number;
      if (rangeOffset === 0) {
        glyphId = (codePoint + delta) & 0xffff;
      } else {
        const glyphOffset = rangeOffsetPosition + rangeOffset + (codePoint - start) * 2;
        if (glyphOffset + 2 > subtableEnd) {
          throw new Error("The bundled PDF font has an invalid cmap format 4 glyph offset.");
        }
        glyphId = view.getUint16(glyphOffset);
        if (glyphId !== 0) glyphId = (glyphId + delta) & 0xffff;
      }
      if (glyphId !== 0) coverage.add(codePoint);
      if (coverage.size > MAX_CMAP_CODE_POINTS) {
        throw new Error("The bundled PDF font cmap is unexpectedly large.");
      }
    }
  }
}

function addFormat12Coverage(view: DataView, subtableOffset: number, coverage: Set<number>): void {
  requireBytes(view, subtableOffset, 16, "cmap format 12");
  const length = view.getUint32(subtableOffset + 4);
  requireBytes(view, subtableOffset, length, "cmap format 12");
  const groupCount = view.getUint32(subtableOffset + 12);
  requireBytes(view, subtableOffset + 16, groupCount * 12, "cmap format 12 groups");

  for (let index = 0; index < groupCount; index += 1) {
    const groupOffset = subtableOffset + 16 + index * 12;
    const start = view.getUint32(groupOffset);
    const end = view.getUint32(groupOffset + 4);
    const startGlyphId = view.getUint32(groupOffset + 8);
    if (start > end || end > 0x10ffff) {
      throw new Error("The bundled PDF font has an invalid cmap format 12 range.");
    }
    if (end - start + 1 > MAX_CMAP_CODE_POINTS - coverage.size) {
      throw new Error("The bundled PDF font cmap is unexpectedly large.");
    }
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      const glyphId = startGlyphId + (codePoint - start);
      if (glyphId !== 0 && (codePoint < 0xd800 || codePoint > 0xdfff)) {
        coverage.add(codePoint);
      }
    }
  }
}

export function parseTrueTypeGlyphCoverage(buffer: ArrayBuffer): ReadonlySet<number> {
  const view = new DataView(buffer);
  requireBytes(view, 0, 12, "TrueType header");
  const tableCount = view.getUint16(4);
  requireBytes(view, 12, tableCount * 16, "TrueType table directory");

  let cmapOffset: number | undefined;
  let cmapLength: number | undefined;
  for (let index = 0; index < tableCount; index += 1) {
    const recordOffset = 12 + index * 16;
    if (tableTag(view, recordOffset) !== "cmap") continue;
    cmapOffset = view.getUint32(recordOffset + 8);
    cmapLength = view.getUint32(recordOffset + 12);
    break;
  }
  if (cmapOffset === undefined || cmapLength === undefined) {
    throw new Error("The bundled PDF font has no Unicode cmap table.");
  }
  requireBytes(view, cmapOffset, cmapLength, "cmap");
  requireBytes(view, cmapOffset, 4, "cmap header");
  const subtableCount = view.getUint16(cmapOffset + 2);
  requireBytes(view, cmapOffset + 4, subtableCount * 8, "cmap encoding records");

  const coverage = new Set<number>();
  const parsedOffsets = new Set<number>();
  for (let index = 0; index < subtableCount; index += 1) {
    const recordOffset = cmapOffset + 4 + index * 8;
    const platformId = view.getUint16(recordOffset);
    const encodingId = view.getUint16(recordOffset + 2);
    if (platformId !== 0 && !(platformId === 3 && (encodingId === 1 || encodingId === 10))) {
      continue;
    }
    const relativeOffset = view.getUint32(recordOffset + 4);
    const subtableOffset = cmapOffset + relativeOffset;
    if (subtableOffset < cmapOffset || subtableOffset >= cmapOffset + cmapLength) {
      throw new Error("The bundled PDF font has an invalid cmap subtable offset.");
    }
    if (parsedOffsets.has(subtableOffset)) continue;
    parsedOffsets.add(subtableOffset);
    requireBytes(view, subtableOffset, 2, "cmap subtable");
    const format = view.getUint16(subtableOffset);
    if (format === 4) addFormat4Coverage(view, subtableOffset, coverage);
    else if (format === 12) addFormat12Coverage(view, subtableOffset, coverage);
  }
  if (coverage.size === 0) {
    throw new Error("The bundled PDF font has no supported Unicode cmap format.");
  }
  return coverage;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function fetchFont(url: string, label: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PDF_FONT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${String(response.status)}.`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_FONT_BYTES) {
      throw new Error(`${label} exceeds the PDF font size limit.`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_FONT_BYTES) {
      throw new Error(`${label} has an invalid PDF font size.`);
    }
    return buffer;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out while loading.`, { cause: error });
    }
    throw new Error(`${label} could not be loaded.`, { cause: error });
  } finally {
    window.clearTimeout(timer);
  }
}

let fontResourcesPromise: Promise<PdfFontResources> | undefined;

async function loadFontResources(): Promise<PdfFontResources> {
  const [regularBuffer, boldBuffer] = await Promise.all([
    fetchFont(notoSansRegularUrl, "The bundled regular Noto Sans font"),
    fetchFont(notoSansBoldUrl, "The bundled bold Noto Sans font"),
  ]);
  const regularCoverage = parseTrueTypeGlyphCoverage(regularBuffer);
  const boldCoverage = parseTrueTypeGlyphCoverage(boldBuffer);
  const sharedCoverage = new Set(
    [...regularCoverage].filter((codePoint) => boldCoverage.has(codePoint)),
  );
  for (const codePoint of REQUIRED_FONT_CODE_POINTS) {
    if (!sharedCoverage.has(codePoint)) {
      throw new Error(
        `The bundled PDF fonts do not share required glyph U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}.`,
      );
    }
  }
  return {
    family: PDF_FONT_FAMILY,
    licenseUrl: notoSansLicenseUrl,
    regular: { filename: "NotoSans-Regular.ttf", base64: bytesToBase64(regularBuffer) },
    bold: { filename: "NotoSans-Bold.ttf", base64: bytesToBase64(boldBuffer) },
    supportedCodePoints: sharedCoverage,
  };
}

export function loadPdfFontResources(): Promise<PdfFontResources> {
  fontResourcesPromise ??= loadFontResources().catch((error: unknown) => {
    fontResourcesPromise = undefined;
    throw error;
  });
  return fontResourcesPromise;
}

export function firstUnsupportedPdfGlyph(
  entries: readonly PdfTextEntry[],
  supportedCodePoints: ReadonlySet<number>,
): UnsupportedPdfGlyph | undefined {
  for (const entry of entries) {
    for (const character of entry.text) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined || codePoint === 0x0a) {
        continue;
      }
      if (!supportedCodePoints.has(codePoint)) {
        return { label: entry.label, character, codePoint };
      }
    }
  }
  return undefined;
}

export function assertPdfGlyphCoverage(
  entries: readonly PdfTextEntry[],
  supportedCodePoints: ReadonlySet<number>,
): void {
  const unsupported = firstUnsupportedPdfGlyph(entries, supportedCodePoints);
  if (unsupported) throw new PdfUnsupportedGlyphError(unsupported);
}
