import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildReportPreview,
  createDemoCase,
  ReportPreviewSchema,
  type ReportPreview,
  type ReportSnapshot,
} from "../../src/domain";
import {
  exportReportPdf,
  normalizePdfText,
  reportSceneExportDecision,
} from "../../src/export/exporters";
import { PDF_FONT_FAMILY } from "../../src/export/pdfFonts";

interface PdfTextCall {
  page: number;
  x: number;
  y: number;
  lines: string[];
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
}

interface PdfInstanceRecord {
  pageCount: number;
  currentPage: number;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  operationCount: number;
  textCalls: PdfTextCall[];
  savedFilename?: string;
}

const pdfMock = vi.hoisted(() => ({ instances: [] as PdfInstanceRecord[] }));

vi.mock("jspdf", () => ({
  jsPDF: class FakeJsPdf {
    private readonly record: PdfInstanceRecord;

    constructor() {
      this.record = {
        pageCount: 1,
        currentPage: 1,
        fontFamily: "helvetica",
        fontStyle: "normal",
        fontSize: 9,
        operationCount: 0,
        textCalls: [],
      };
      pdfMock.instances.push(this.record);
    }

    setProperties(): void {
      this.record.operationCount += 1;
    }
    setFillColor(): void {
      this.record.operationCount += 1;
    }
    setTextColor(): void {
      this.record.operationCount += 1;
    }
    setDrawColor(): void {
      this.record.operationCount += 1;
    }
    setLineWidth(): void {
      this.record.operationCount += 1;
    }
    rect(): void {
      this.record.operationCount += 1;
    }
    line(): void {
      this.record.operationCount += 1;
    }
    addImage(): void {
      this.record.operationCount += 1;
    }
    addFileToVFS(): void {
      this.record.operationCount += 1;
    }
    addFont(): void {
      this.record.operationCount += 1;
    }
    getFontList(): Record<string, string[]> {
      return { [PDF_FONT_FAMILY]: ["normal", "bold"] };
    }

    setFont(fontFamily: string, fontStyle: string): void {
      this.record.fontFamily = fontFamily;
      this.record.fontStyle = fontStyle;
    }

    setFontSize(fontSize: number): void {
      this.record.fontSize = fontSize;
    }

    splitTextToSize(text: string, width: number): string[] {
      const charactersPerLine = Math.max(8, Math.floor(width * 1.2));
      if (text.length === 0) return [""];
      return Array.from({ length: Math.ceil(text.length / charactersPerLine) }, (_, index) =>
        text.slice(index * charactersPerLine, (index + 1) * charactersPerLine),
      );
    }

    text(value: string | string[], x: number, y: number): void {
      this.record.textCalls.push({
        page: this.record.currentPage,
        x,
        y,
        lines: typeof value === "string" ? [value] : value,
        fontFamily: this.record.fontFamily,
        fontStyle: this.record.fontStyle,
        fontSize: this.record.fontSize,
      });
    }

    addPage(): void {
      this.record.pageCount += 1;
      this.record.currentPage = this.record.pageCount;
    }

    getNumberOfPages(): number {
      return this.record.pageCount;
    }

    setPage(page: number): void {
      this.record.currentPage = page;
    }

    save(filename: string): void {
      this.record.savedFilename = filename;
    }
  },
}));

beforeAll(async () => {
  const [regular, bold] = await Promise.all([
    readFile(path.join(process.cwd(), "node_modules/notosans-fontface/fonts/NotoSans-Regular.ttf")),
    readFile(path.join(process.cwd(), "node_modules/notosans-fontface/fonts/NotoSans-Bold.ttf")),
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const requestedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const selected = requestedUrl.includes("Bold") ? bold : regular;
      const bytes = selected.buffer.slice(
        selected.byteOffset,
        selected.byteOffset + selected.byteLength,
      ) as ArrayBuffer;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(bytes.byteLength) }),
        arrayBuffer: () => Promise.resolve(bytes),
      } as Response);
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function maximumContentPreview(): ReportPreview {
  const replayCase = createDemoCase();
  const claimIds = Array.from({ length: 5_000 }, (_, index) => `claim-${String(index)}`);
  const evidenceIds = Array.from({ length: 5_000 }, (_, index) => `evidence-${String(index)}`);
  const workspacePaths = Array.from(
    { length: 10_000 },
    (_, index) => `workspace.path.${String(index)}`,
  );
  return ReportPreviewSchema.parse({
    caseId: replayCase.id,
    caseVersion: replayCase.caseVersion + 1,
    generatedAt: "2026-08-29T12:00:00.000Z",
    title: "T".repeat(500),
    sections: [
      {
        id: "section-max-content",
        title: "Maximum valid report section ".padEnd(500, "S"),
        statements: [
          {
            id: "statement-max-content",
            text: "Long evidence-bound statement. ".repeat(400).slice(0, 10_000),
            certainty: "confirmed",
            citations: { claimIds, evidenceIds, workspacePaths },
          },
        ],
      },
    ],
    includedClaimIds: [],
    includedEvidenceIds: [],
    unresolvedQuestionIds: [],
    missingRequirements: ["Incident date or approximate date", "Evidence index"],
    disclaimer: "Human review remains required. ".repeat(400).slice(0, 10_000),
  });
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("The captured scene SVG was not returned as text."));
      },
      { once: true },
    );
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Could not read the captured scene SVG.")),
      { once: true },
    );
    reader.readAsText(blob);
  });
}

describe("PDF report pagination", () => {
  it("paginates maximum schema-valid narrative and citation content without clipping headings", async () => {
    pdfMock.instances.length = 0;
    const replayCase = createDemoCase();
    const preview = maximumContentPreview();

    await exportReportPdf(replayCase, preview, {
      playheadTimeMs: 0,
      comparisonBranchIds: [],
    });

    const record = pdfMock.instances.at(-1);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.pageCount).toBeGreaterThan(10);
    expect(record.savedFilename).toMatch(/-draft-factual-report\.pdf$/);

    const contentCalls = record.textCalls.filter((call) => call.y < 283);
    for (const call of contentCalls) {
      const finalBaseline = call.y + (call.lines.length - 1) * call.fontSize * 0.47;
      expect(finalBaseline).toBeLessThanOrEqual(274.001);
    }

    const titleCall = record.textCalls.find(
      (call) => call.fontFamily === PDF_FONT_FAMILY && call.lines.join("") === preview.title,
    );
    expect(titleCall?.lines.length).toBeGreaterThan(1);

    const sectionHeading = record.textCalls.find((call) =>
      call.lines.join("").startsWith("MAXIMUM VALID REPORT SECTION"),
    );
    expect(sectionHeading).toBeDefined();
    if (!sectionHeading) throw new Error("The section heading was not rendered.");
    expect(
      record.textCalls.some(
        (call) =>
          call.page === sectionHeading.page && call.y > sectionHeading.y && call.fontSize === 9,
      ),
    ).toBe(true);

    const renderedText = record.textCalls.flatMap((call) => call.lines).join("");
    expect(renderedText).toContain("Long evidence-bound statement");
    expect(renderedText).toContain("Citation key:");
    expect(renderedText).toContain("Observation record IDs");
    expect(renderedText).toContain("Evidence item IDs");
    expect(renderedText).toContain("Structured case paths");
    expect(renderedText).toContain("claim-4999");
    expect(renderedText).toContain("evidence-4999");
    expect(renderedText).toContain("workspace.path.9999");
    expect(renderedText).toContain("Human review remains required");
    expect(renderedText).toContain("Missing requirements before finalization".toUpperCase());
    expect(renderedText).toContain("Incident date or approximate date");
    for (let page = 1; page <= record.pageCount; page += 1) {
      expect(
        record.textCalls.some(
          (call) => call.page === page && call.lines.join(" ").includes("DRAFT — NOT FINALIZED"),
        ),
      ).toBe(true);
    }
  });

  it("labels a selected immutable snapshot with its persisted identity and no draft watermark", async () => {
    pdfMock.instances.length = 0;
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(
      preview.sections
        .flatMap((section) => section.statements)
        .find((statement) => statement.id === "report-scene-diagram")?.text,
    ).toContain("Export its scene review snapshot separately");
    const snapshot: ReportSnapshot = {
      id: "report-snapshot-final-test",
      caseVersion: 2,
      createdAt: "2026-08-29T12:05:00.000Z",
      confirmedClaimIds: preview.includedClaimIds,
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: preview.reviewBinding?.branchIds ?? ["branch-baseline"],
      humanAcknowledged: true,
      immutable: true,
      preview,
    };
    replayCase.caseVersion = 3;
    replayCase.title = "Newer unrelated title 😀";

    await exportReportPdf(replayCase, snapshot.preview, {
      playheadTimeMs: 0,
      comparisonBranchIds: [],
      finalizedSnapshot: snapshot,
    });

    const record = pdfMock.instances.at(-1);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.savedFilename).toMatch(/-finalized-report-snapshot-final-test\.pdf$/);
    expect(record.savedFilename).not.toContain("newer-unrelated-title");
    const renderedText = record.textCalls.flatMap((call) => call.lines).join(" ");
    expect(renderedText).toContain("FINALIZED FACTUAL SNAPSHOT");
    expect(renderedText).toContain(snapshot.id);
    expect(renderedText).toContain("Reviewed case version 1");
    expect(renderedText).toContain("2026-08-29T12:05:00.000Z");
    expect(renderedText).not.toContain("DRAFT — NOT FINALIZED");
    expect(renderedText.toLowerCase()).not.toContain("the accompanying");
  });

  it("omits the unbound live scene from a finalized snapshot before and after later edits", () => {
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    const snapshot: ReportSnapshot = {
      id: "report-snapshot-scene-binding",
      caseVersion: preview.caseVersion + 1,
      createdAt: "2026-08-29T12:05:00.000Z",
      confirmedClaimIds: preview.includedClaimIds,
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: preview.reviewBinding?.branchIds ?? [replayCase.activeBranchId],
      humanAcknowledged: true,
      immutable: true,
      preview,
    };
    replayCase.caseVersion = snapshot.caseVersion;

    for (const sceneContext of [
      { playheadTimeMs: 0, comparisonBranchIds: [] },
      {
        playheadTimeMs: 10_000,
        comparisonBranchIds: [replayCase.activeBranchId, "branch-outside-snapshot"],
      },
    ]) {
      expect(
        reportSceneExportDecision(replayCase, preview, {
          ...sceneContext,
          finalizedSnapshot: snapshot,
        }),
      ).toMatchObject({
        include: false,
        comparisonBranchIds: [],
        omissionReason: expect.stringContaining("does not bind an immutable scene image"),
      });
    }

    replayCase.caseVersion += 1;
    expect(
      reportSceneExportDecision(replayCase, preview, {
        playheadTimeMs: 0,
        comparisonBranchIds: [],
        finalizedSnapshot: snapshot,
      }),
    ).toMatchObject({
      include: false,
      omissionReason: expect.stringContaining("does not bind an immutable scene image"),
    });
  });

  it("omits a live active branch because finalized snapshots do not bind session scene state", () => {
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    const snapshot: ReportSnapshot = {
      id: "report-snapshot-branch-scope",
      caseVersion: preview.caseVersion + 1,
      createdAt: "2026-08-29T12:05:00.000Z",
      confirmedClaimIds: preview.includedClaimIds,
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: [replayCase.activeBranchId],
      humanAcknowledged: true,
      immutable: true,
      preview,
    };
    replayCase.caseVersion = snapshot.caseVersion;
    replayCase.activeBranchId = "branch-outside-reviewed-scope";

    expect(
      reportSceneExportDecision(replayCase, preview, {
        playheadTimeMs: 0,
        comparisonBranchIds: snapshot.branchIds,
        finalizedSnapshot: snapshot,
      }),
    ).toMatchObject({
      include: false,
      comparisonBranchIds: [],
      omissionReason: expect.stringContaining("does not bind an immutable scene image"),
    });
  });

  it("clarifies legacy finalized text that called an unbound scene diagram accompanying", () => {
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    const sceneStatement = preview.sections
      .find((section) => section.id === "scene-diagram")
      ?.statements.find((statement) => statement.id === "report-scene-diagram");
    if (!sceneStatement) throw new Error("The scene statement is missing.");
    sceneStatement.text = "The accompanying roundabout diagram shows the active reconstruction.";
    delete preview.reviewBinding;
    const snapshot: ReportSnapshot = {
      id: "report-snapshot-legacy-scene-copy",
      caseVersion: preview.caseVersion + 1,
      createdAt: "2026-08-29T12:05:00.000Z",
      confirmedClaimIds: preview.includedClaimIds,
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: [replayCase.activeBranchId],
      humanAcknowledged: true,
      immutable: true,
      preview,
    };

    expect(
      reportSceneExportDecision(replayCase, preview, {
        playheadTimeMs: 0,
        comparisonBranchIds: [],
        finalizedSnapshot: snapshot,
      }).omissionReason,
    ).toContain("no scene image is attached to this PDF");
  });

  it("freezes a live draft scene before asynchronous export work can observe later DOM state", async () => {
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    document.body.innerHTML = `
      <svg class="scene-svg" xmlns="http://www.w3.org/2000/svg">
        <text data-scene-state="original">ORIGINAL FROZEN SCENE</text>
      </svg>`;
    let capturedSvg: Blob | undefined;
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (blob instanceof Blob && blob.type.startsWith("image/svg+xml")) capturedSvg = blob;
      return "blob:captured-scene";
    });
    const originalImage = globalThis.Image;
    function ImmediateErrorImage(): HTMLImageElement {
      const image = document.createElement("img");
      Object.defineProperty(image, "src", {
        configurable: true,
        get: () => image.getAttribute("src") ?? "",
        set: (value: string) => {
          image.setAttribute("src", value);
          queueMicrotask(() => image.dispatchEvent(new Event("error")));
        },
      });
      return image;
    }
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      writable: true,
      value: ImmediateErrorImage,
    });

    try {
      const exporting = exportReportPdf(replayCase, preview, {
        playheadTimeMs: 0,
        comparisonBranchIds: [],
      });
      const liveLabel = document.querySelector<SVGTextElement>("[data-scene-state]");
      if (!liveLabel) throw new Error("The live scene label was not created.");
      liveLabel.textContent = "MUTATED AFTER EXPORT CLICK";
      await exporting;

      expect(capturedSvg).toBeDefined();
      if (!capturedSvg) return;
      const serialized = await readBlobText(capturedSvg);
      expect(serialized).toContain("ORIGINAL FROZEN SCENE");
      expect(serialized).not.toContain("MUTATED AFTER EXPORT CLICK");
    } finally {
      createObjectUrl.mockRestore();
      Object.defineProperty(globalThis, "Image", {
        configurable: true,
        writable: true,
        value: originalImage,
      });
      document.body.replaceChildren();
    }
  });

  it("refuses to apply finalized metadata to different preview content", async () => {
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    const snapshot: ReportSnapshot = {
      id: "report-snapshot-mismatch-test",
      caseVersion: 2,
      createdAt: "2026-08-29T12:05:00.000Z",
      confirmedClaimIds: preview.includedClaimIds,
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: preview.reviewBinding?.branchIds ?? ["branch-baseline"],
      humanAcknowledged: true,
      immutable: true,
      preview,
    };
    const different = structuredClone(preview);
    different.title = "A different visible preview";

    await expect(
      exportReportPdf(replayCase, different, {
        playheadTimeMs: 0,
        comparisonBranchIds: [],
        finalizedSnapshot: snapshot,
      }),
    ).rejects.toThrow("does not match");
  });

  it("renders Cyrillic report content through the registered Unicode font", async () => {
    pdfMock.instances.length = 0;
    const replayCase = createDemoCase();
    replayCase.title = "Дорожный инцидент";
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    preview.title = "Фактический отчёт о столкновении";
    const statement = preview.sections.flatMap((section) => section.statements)[0];
    if (!statement) throw new Error("The seeded preview has no statement for the Unicode test.");
    statement.text = "Автомобиль\tдвигался\r\nпо подтверждённой\rтраектории.";
    replayCase.caseVersion += 1;

    await exportReportPdf(replayCase, preview, {
      playheadTimeMs: 0,
      comparisonBranchIds: [],
    });

    const record = pdfMock.instances.at(-1);
    expect(record?.savedFilename).toMatch(/-draft-factual-report\.pdf$/);
    const renderedText = record?.textCalls.flatMap((call) => call.lines).join("\n") ?? "";
    expect(renderedText).toContain(normalizePdfText(statement.text));
    expect(renderedText).not.toMatch(/[\t\r]/);
    expect(record?.textCalls.every((call) => call.fontFamily === PDF_FONT_FAMILY)).toBe(true);
  });

  it("normalizes valid tabs and carriage-return line breaks before PDF layout", () => {
    expect(normalizePdfText("A\tB\r\nC\rD")).toBe("A    B\nC\nD");
  });

  it.each([
    ["emoji", "Confirmed path 😀", "U+1F600"],
    ["CJK", "確認された経路", "U+78BA"],
  ])("fails closed before saving unsupported %s report text", async (_label, text, codePoint) => {
    pdfMock.instances.length = 0;
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    const statement = preview.sections.flatMap((section) => section.statements)[0];
    if (!statement) throw new Error("The seeded preview has no statement for the Unicode test.");
    statement.text = text;
    replayCase.caseVersion += 1;

    await expect(
      exportReportPdf(replayCase, preview, {
        playheadTimeMs: 0,
        comparisonBranchIds: [],
      }),
    ).rejects.toMatchObject({
      code: "PDF_UNSUPPORTED_GLYPH",
      field: `report statement ${statement.id}`,
      message: expect.stringContaining(codePoint),
    });
    expect(pdfMock.instances).toHaveLength(0);
  });
});
