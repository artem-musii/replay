import type { ReplayCase, ReportPreview } from "../domain";
import { exportReplayCase } from "../domain";

function safeFilename(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72)
      .toLowerCase() || "replay-case"
  );
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function sceneSvgElement(): SVGSVGElement {
  const element = document.querySelector<SVGSVGElement>(".scene-svg");
  if (!element) throw new Error("Open the scene before exporting it.");
  return element;
}

function sceneExportElement(): HTMLElement {
  const element = sceneSvgElement().parentElement;
  if (!element) throw new Error("The scene export surface is unavailable.");
  return element;
}

function serializedSceneSvg(): string {
  const svg = sceneSvgElement().cloneNode(true) as SVGSVGElement;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "1600");
  svg.setAttribute("height", "1120");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    .scene-ground{fill:#d7d4c9}.road-surface{fill:#535d5e}.road-marking{stroke:#ecebdc;fill:none}.road-island{fill:#b8b9a9}.sidewalk{fill:#c6c3b8}
    .trajectory__line{fill:none;stroke:#2a758b;stroke-width:4;stroke-dasharray:10 7}.trajectory__handle{fill:#f5f1e7;stroke:#2a758b;stroke-width:3}
    .vehicle-body{fill:#64889a;stroke:#f8f4ea;stroke-width:2}.vehicle-label{fill:#1e3034;font:700 15px sans-serif}.impact-marker{stroke:#b44634;fill:#f5d3bc}
  `;
  svg.prepend(style);
  return new XMLSerializer().serializeToString(svg);
}

export function exportCaseJson(replayCase: ReplayCase): void {
  download(
    new Blob([exportReplayCase(replayCase)], { type: "application/json;charset=utf-8" }),
    `${safeFilename(replayCase.title)}.replay.json`,
  );
}

export function exportSceneSvg(replayCase: ReplayCase): void {
  download(
    new Blob([serializedSceneSvg()], { type: "image/svg+xml;charset=utf-8" }),
    `${safeFilename(replayCase.title)}-scene.svg`,
  );
}

export async function exportScenePng(replayCase: ReplayCase): Promise<void> {
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(sceneExportElement(), {
    width: 1600,
    height: 1120,
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#d7d4c9",
  });
  const response = await fetch(dataUrl);
  download(await response.blob(), `${safeFilename(replayCase.title)}-scene.png`);
}

export async function exportReportPdf(
  replayCase: ReplayCase,
  preview: ReportPreview,
): Promise<void> {
  const [{ jsPDF }, { toPng }] = await Promise.all([import("jspdf"), import("html-to-image")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const margin = 18;
  const width = 210 - margin * 2;
  const pageHeight = 297;
  let y = 20;

  function newPageIfNeeded(height: number): void {
    if (y + height < pageHeight - 20) return;
    pdf.addPage();
    y = 20;
  }

  function paragraph(text: string, size = 9, color: [number, number, number] = [51, 62, 63]): void {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(text, width) as string[];
    newPageIfNeeded(lines.length * 4.4 + 3);
    pdf.text(lines, margin, y);
    y += lines.length * 4.4 + 3;
  }

  pdf.setFillColor(38, 68, 69);
  pdf.rect(0, 0, 210, 44, "F");
  pdf.setTextColor(244, 241, 232);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("REPLAY  ·  FACTUAL ACCOUNT", margin, 14);
  pdf.setFont("times", "normal");
  pdf.setFontSize(21);
  pdf.text(preview.title.slice(0, 70), margin, 28);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(
    `Case version ${preview.caseVersion}  ·  Generated ${new Date(preview.generatedAt).toLocaleString()}`,
    margin,
    36,
  );
  y = 55;

  try {
    const scene = sceneExportElement();
    const scenePng = await toPng(scene, {
      width: 1400,
      height: 980,
      pixelRatio: 1.5,
      backgroundColor: "#d7d4c9",
    });
    pdf.addImage(scenePng, "PNG", margin, y, width, 77, undefined, "FAST");
    y += 84;
  } catch {
    paragraph(
      "Scene diagram could not be embedded in this export. The structured scene remains available in the JSON backup.",
      8,
      [100, 100, 100],
    );
  }

  for (const section of preview.sections) {
    newPageIfNeeded(16);
    pdf.setDrawColor(45, 74, 75);
    pdf.setLineWidth(0.4);
    pdf.line(margin, y, margin + width, y);
    y += 6;
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(37, 48, 50);
    pdf.setFontSize(10);
    pdf.text(section.title.toUpperCase(), margin, y);
    y += 6;
    if (section.statements.length === 0) {
      paragraph("Nothing recorded.", 8, [105, 105, 105]);
      continue;
    }
    for (const statement of section.statements) {
      paragraph(`${statement.text} (${statement.certainty})`, 9);
      const citations = [...statement.citations.claimIds, ...statement.citations.evidenceIds];
      if (citations.length > 0) paragraph(`Sources: ${citations.join(", ")}`, 7, [96, 100, 101]);
    }
    y += 2;
  }

  newPageIfNeeded(22);
  pdf.setFillColor(235, 233, 224);
  pdf.rect(margin, y, width, 1, "F");
  y += 8;
  paragraph(preview.disclaimer, 8, [77, 82, 83]);
  pdf.save(`${safeFilename(replayCase.title)}-factual-report.pdf`);
}
