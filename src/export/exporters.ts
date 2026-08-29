import type { ReplayCase, ReportPreview, ReportSnapshot } from "../domain";
import { exportReplayCase, SCENE_VIEW_HEIGHT, SCENE_VIEW_WIDTH } from "../domain";
import { createSceneCoordinateMapper } from "../domain/sceneCoordinates";
import {
  assertPdfGlyphCoverage,
  loadPdfFontResources,
  PDF_FONT_FAMILY,
  type PdfTextEntry,
} from "./pdfFonts";

export interface SceneExportContext {
  playheadTimeMs: number;
  comparisonBranchIds: readonly string[];
}

export interface ReportPdfExportContext extends SceneExportContext {
  finalizedSnapshot?: ReportSnapshot | undefined;
}

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
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Keep large downloads valid long enough for slower browser download
    // managers to consume the object URL, then release its backing memory.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

const PNG_MIME_TYPE = "image/png";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const SCENE_RASTER_TIMEOUT_MS = 10_000;
const SCENE_EXPORT_CONTEXT_HEIGHT = 100;
const SCENE_EXPORT_WIDTH = 1600;
const SCENE_EXPORT_HEIGHT = 1280;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function readBlobPrefix(blob: Blob, byteLength: number): Promise<ArrayBuffer> {
  const prefix = blob.slice(0, byteLength);
  if (typeof prefix.arrayBuffer === "function") return prefix.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("The scene PNG signature could not be read."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("The scene PNG signature could not be read."));
    });
    reader.readAsArrayBuffer(prefix);
  });
}

async function validatePngBlob(blob: Blob): Promise<Blob> {
  if (blob.type.toLowerCase() !== PNG_MIME_TYPE) {
    throw new Error("Scene PNG export returned an unexpected media type.");
  }
  const signature = new Uint8Array(await readBlobPrefix(blob, PNG_SIGNATURE.length));
  if (
    blob.size <= PNG_SIGNATURE.length ||
    signature.length !== PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((value, index) => signature[index] === value)
  ) {
    throw new Error("Scene PNG export returned invalid PNG data.");
  }
  return blob;
}

export async function canvasToPngBlob(
  canvas: HTMLCanvasElement,
  timeoutMs = SCENE_RASTER_TIMEOUT_MS,
): Promise<Blob> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The scene PNG encoding timeout must be a positive duration.");
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("The scene PNG encoding timed out.")),
      timeoutMs,
    );
    try {
      canvas.toBlob((encoded) => {
        window.clearTimeout(timer);
        if (!encoded) {
          reject(new Error("The browser could not encode the scene as PNG."));
          return;
        }
        resolve(encoded);
      }, PNG_MIME_TYPE);
    } catch (error) {
      window.clearTimeout(timer);
      reject(new Error("The browser could not encode the scene as PNG.", { cause: error }));
    }
  });
  return validatePngBlob(blob);
}

function sceneSvgElement(): SVGSVGElement {
  const element = document.querySelector<SVGSVGElement>(".scene-svg");
  if (!element) throw new Error("Open the scene before exporting it.");
  return element;
}

const SVG_PRESENTATION_PROPERTIES = [
  "color",
  "display",
  "dominant-baseline",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "flood-color",
  "flood-opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "mask",
  "opacity",
  "paint-order",
  "shape-rendering",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "vector-effect",
  "visibility",
] as const;

const SVG_COLOR_PROPERTIES = new Set<(typeof SVG_PRESENTATION_PROPERTIES)[number]>([
  "color",
  "fill",
  "flood-color",
  "stop-color",
  "stroke",
]);
const SVG_COLOR_ATTRIBUTES = ["color", "fill", "flood-color", "stop-color", "stroke"] as const;

let colorConversionContext: CanvasRenderingContext2D | null | undefined;

function srgbColor(value: string): string {
  if (
    typeof CSS === "undefined" ||
    typeof CSS.supports !== "function" ||
    !CSS.supports("color", value)
  )
    return value;
  if (colorConversionContext === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorConversionContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  const context = colorConversionContext;
  if (!context) return value;

  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(0, 0, 1, 1).data;
  if (alpha === 255) return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
  const normalizedAlpha = Math.round((alpha / 255) * 1_000) / 1_000;
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(normalizedAlpha)})`;
}

function localizeSvgFragmentUrls(value: string): string {
  return value.replace(/url\(["']?[^#)]*#([^"')]+)["']?\)/g, "url(#$1)");
}

function inlineScenePresentation(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sourceElements = [source, ...source.querySelectorAll<SVGElement>("*")];
  const cloneElements = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  sourceElements.forEach((sourceElement, index) => {
    const cloneElement = cloneElements[index];
    if (!cloneElement) return;
    const computed = window.getComputedStyle(sourceElement);
    SVG_PRESENTATION_PROPERTIES.forEach((property) => {
      const value = computed.getPropertyValue(property).trim();
      if (!value) return;
      const localized = localizeSvgFragmentUrls(value);
      cloneElement.style.setProperty(
        property,
        SVG_COLOR_PROPERTIES.has(property) ? srgbColor(localized) : localized,
      );
    });
    SVG_COLOR_ATTRIBUTES.forEach((attribute) => {
      const value = cloneElement.getAttribute(attribute)?.trim();
      if (value) cloneElement.setAttribute(attribute, srgbColor(localizeSvgFragmentUrls(value)));
    });
  });
}

function cleanXmlText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const invalid =
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0xfffe ||
      codePoint === 0xffff;
    return invalid ? "�" : character;
  }).join("");
}

function truncateContextText(value: string, maxLength: number): string {
  const normalized = cleanXmlText(value).replace(/\s+/g, " ").trim();
  const codePoints = Array.from(normalized);
  return codePoints.length <= maxLength
    ? normalized
    : `${codePoints.slice(0, maxLength - 1).join("")}…`;
}

function formatExportSeconds(timeMs: number): string {
  const rounded = Math.round(timeMs);
  return (rounded / 1_000).toFixed(rounded % 100 === 0 ? 1 : 3);
}

function svgElement(name: string): SVGElement {
  return document.createElementNS(SVG_NAMESPACE, name);
}

function appendContextLine(group: SVGElement, text: string, y: number, emphasized = false): void {
  const line = svgElement("text");
  line.setAttribute("x", "28");
  line.setAttribute("y", String(y));
  line.setAttribute("fill", emphasized ? "#fffdf8" : "#e7ece8");
  line.setAttribute("font-family", "Inter, ui-sans-serif, system-ui, sans-serif");
  line.setAttribute("font-size", emphasized ? "13" : "11.5");
  line.setAttribute("font-weight", emphasized ? "750" : "560");
  line.setAttribute("letter-spacing", emphasized ? "0.025em" : "0");
  line.textContent = truncateContextText(text, emphasized ? 125 : 145);
  group.append(line);
}

function visiblePlacedImpacts(replayCase: ReplayCase) {
  return replayCase.timelineEvents.filter(
    (event) =>
      event.branchId === replayCase.activeBranchId && event.type === "impact" && event.location,
  );
}

function sceneContextLines(
  replayCase: ReplayCase,
  context: SceneExportContext,
  svg: SVGSVGElement,
): string[] {
  const activeBranch = replayCase.branches.find(
    (branch) => branch.id === replayCase.activeBranchId,
  );
  const comparisonNames = context.comparisonBranchIds
    .filter((branchId) => branchId !== replayCase.activeBranchId)
    .map(
      (branchId) => replayCase.branches.find((branch) => branch.id === branchId)?.name ?? branchId,
    );
  const visibleImpacts = visiblePlacedImpacts(replayCase);
  const certaintyCounts = new Map<string, number>();
  for (const event of visibleImpacts) {
    certaintyCounts.set(event.certainty, (certaintyCounts.get(event.certainty) ?? 0) + 1);
  }
  const impactSummary =
    visibleImpacts.length === 0
      ? "none placed"
      : [...certaintyCounts]
          .map(([certainty, count]) => `${certainty} ${String(count)}`)
          .join(", ");
  const pendingProposalChanges = replayCase.proposals
    .filter((proposal) => proposal.status === "pending")
    .reduce((count, proposal) => count + (proposal.revisions.at(-1)?.changes.length ?? 0), 0);
  const visibleAgentAuthored = svg.querySelectorAll(
    ".trajectory.is-agent-authored, .scene-vehicle.is-agent-authored",
  ).length;
  const visibleAcceptedAgentGeometry = svg.querySelectorAll(
    ".trajectory.is-accepted-agent-proposal, .scene-vehicle.is-accepted-agent-proposal",
  ).length;
  const visibleUnverifiedImportedGeometry = svg.querySelectorAll(
    ".trajectory.is-unverified-imported-proposal, .scene-vehicle.is-unverified-imported-proposal",
  ).length;
  const comparisonSummary =
    comparisonNames.length === 0
      ? "none"
      : `${String(comparisonNames.length)} total${comparisonNames.length > 3 ? `, showing 3 · +${String(comparisonNames.length - 3)} more` : ""}: ${comparisonNames
          .slice(0, 3)
          .map((name) => truncateContextText(name, 32))
          .join(", ")}`;

  return [
    `REVIEW SNAPSHOT · Case v${String(replayCase.caseVersion)} · Active branch: ${activeBranch?.name ?? replayCase.activeBranchId} · Playhead: ${formatExportSeconds(context.playheadTimeMs)} s`,
    `Impacts (${String(visibleImpacts.length)}): ${impactSummary} · Calibration: ${replayCase.environment.calibration.source} ±${String(replayCase.environment.calibration.uncertaintyMeters)} m`,
    `Authorship: ${String(visibleAgentAuthored)} agent · ${String(visibleAcceptedAgentGeometry)} accepted-agent · ${String(visibleUnverifiedImportedGeometry)} unverified import · Paths: ${String(svg.querySelectorAll(".trajectory").length)} · Compared branches: ${comparisonSummary}`,
    `Proposal state: ${String(pendingProposalChanges)} pending changes case-wide · ${String(svg.querySelectorAll(".proposal-scene-path, .proposal-scene-actor").length)} visible proposal geometries`,
    "Geometry-only reconstruction · Not a simulation or proof of physical contact.",
  ];
}

function neutralizeTransientSceneState(svg: SVGSVGElement, replayCase: ReplayCase): void {
  const sceneCoordinates = createSceneCoordinateMapper(
    replayCase.environment.bounds,
    SCENE_VIEW_WIDTH,
    SCENE_VIEW_HEIGHT,
  );
  svg.classList.remove("is-placing-impact");
  svg.setAttribute(
    "viewBox",
    `0 0 ${String(SCENE_VIEW_WIDTH)} ${String(SCENE_VIEW_HEIGHT + SCENE_EXPORT_CONTEXT_HEIGHT)}`,
  );
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  svg
    .querySelectorAll(
      ".placement-grid, .trajectory__hit, .trajectory__handle-hit, .trajectory__handle, .trajectory__handle-number, .path-marker-label, .vehicle-hit, .vehicle-rotation-control, .vehicle-label",
    )
    .forEach((element) => element.remove());

  svg.querySelectorAll<SVGGElement>(".trajectory.is-selected").forEach((trajectory) => {
    trajectory.classList.remove("is-selected");
    trajectory
      .querySelector<SVGElement>(".trajectory__line")
      ?.style.setProperty("stroke-width", "4");
  });
  svg.querySelectorAll<SVGGElement>(".scene-vehicle").forEach((vehicle) => {
    const selection = vehicle.querySelector<SVGElement>(".vehicle-selection");
    const hasSemanticOutline =
      vehicle.classList.contains("is-agent-authored") ||
      vehicle.classList.contains("is-accepted-agent-proposal") ||
      vehicle.classList.contains("is-unverified-imported-proposal") ||
      vehicle.classList.contains("has-contact-state");
    if (vehicle.classList.contains("is-selected") && selection && !hasSemanticOutline) {
      selection.style.setProperty("stroke", "rgba(0, 0, 0, 0)");
      selection.style.setProperty("stroke-dasharray", "none");
    }
    vehicle.classList.remove("is-selected", "is-agent-active");
    vehicle.style.removeProperty("filter");
  });
  const impactEvents = visiblePlacedImpacts(replayCase);
  svg.querySelectorAll<SVGGElement>(".impact-marker").forEach((impact, index) => {
    const event = impactEvents[index];
    if (event) {
      impact.setAttribute("data-replay-impact-id", event.id);
      const title = svgElement("title");
      title.textContent = cleanXmlText(
        `${event.title} [${event.id}] · ${event.certainty} · ${formatExportSeconds(event.timeMs)} s`,
      );
      impact.prepend(title);
    }
  });
  svg.querySelectorAll<SVGGElement>(".impact-marker.is-selected").forEach((impact) => {
    impact.classList.remove("is-selected");
    impact.querySelector<SVGElement>("circle")?.style.setProperty("stroke-width", "2");
    impact.querySelectorAll(":scope > text").forEach((label) => label.remove());
  });
  const impactLocationOccurrences = new Map<string, number>();
  svg.querySelectorAll<SVGGElement>(".impact-marker").forEach((impact, index) => {
    const event = impactEvents[index];
    if (!event?.location) return;
    const locationKey = `${event.location.x.toFixed(3)},${event.location.y.toFixed(3)}`;
    const locationOccurrence = impactLocationOccurrences.get(locationKey) ?? 0;
    impactLocationOccurrences.set(locationKey, locationOccurrence + 1);
    const { x: viewX, y: viewY } = sceneCoordinates.toView(event.location);
    const labelSide = viewX >= SCENE_VIEW_WIDTH / 2 ? -1 : 1;
    const labelBelowMarker = viewY < 36;
    const labelRowDirection = viewY > SCENE_VIEW_HEIGHT - 28 ? -1 : 1;
    const labelY = labelBelowMarker
      ? 32 + locationOccurrence * 16
      : -20 + locationOccurrence * 16 * labelRowDirection;
    const label = svgElement("text");
    label.classList.add("replay-export-impact-label");
    label.setAttribute("x", String(labelSide * 32));
    label.setAttribute("y", String(labelY));
    label.setAttribute("text-anchor", labelSide > 0 ? "start" : "end");
    label.setAttribute("fill", "#5b201b");
    label.setAttribute("stroke", "#fffdf8");
    label.setAttribute("stroke-width", "4");
    label.setAttribute("paint-order", "stroke fill");
    label.setAttribute("font-family", "Inter, ui-sans-serif, system-ui, sans-serif");
    label.setAttribute("font-size", "12");
    label.setAttribute("font-weight", "750");
    label.textContent = `I${String(index + 1)} · ${formatExportSeconds(event.timeMs)} s · ${event.certainty}`;
    impact.append(label);
  });
  svg
    .querySelectorAll<SVGGElement>(".impact-marker, .contact-geometry-marker")
    .forEach((marker) => {
      const transform = marker.getAttribute("transform");
      if (transform)
        marker.setAttribute("transform", transform.replace(/\s+scale\([^)]*\)\s*$/, " scale(1)"));
    });

  svg.querySelectorAll("[role], [tabindex], [aria-pressed], [aria-label]").forEach((element) => {
    element.removeAttribute("role");
    element.removeAttribute("tabindex");
    element.removeAttribute("aria-pressed");
    element.removeAttribute("aria-label");
  });
}

function appendSceneExportContext(
  svg: SVGSVGElement,
  replayCase: ReplayCase,
  context: SceneExportContext,
): void {
  const lines = sceneContextLines(replayCase, context, svg);
  const title = svgElement("title");
  title.textContent = cleanXmlText(`${replayCase.title} scene reconstruction review snapshot`);
  const description = svgElement("desc");
  const impactAppendix = visiblePlacedImpacts(replayCase)
    .map(
      (event) =>
        `[${event.id}] ${event.title} — ${event.certainty} at ${formatExportSeconds(event.timeMs)} s`,
    )
    .join("; ");
  description.textContent = cleanXmlText(
    `${lines.join(". ")}${impactAppendix ? `. Impact appendix: ${impactAppendix}.` : ""}`,
  );
  svg.prepend(description);
  svg.prepend(title);

  const panel = svgElement("g");
  panel.setAttribute("data-replay-export-context", "review-snapshot");
  panel.setAttribute("aria-hidden", "true");
  const background = svgElement("rect");
  background.setAttribute("x", "10");
  background.setAttribute("y", "704");
  background.setAttribute("width", "980");
  background.setAttribute("height", "92");
  background.setAttribute("rx", "10");
  background.setAttribute("fill", "#173b3a");
  background.setAttribute("fill-opacity", "0.94");
  background.setAttribute("stroke", "#d9ded8");
  background.setAttribute("stroke-opacity", "0.75");
  panel.append(background);
  appendContextLine(panel, lines[0] ?? "REVIEW SNAPSHOT", 722, true);
  appendContextLine(panel, lines[1] ?? "", 739);
  appendContextLine(panel, lines[2] ?? "", 756);
  appendContextLine(panel, lines[3] ?? "", 773);
  appendContextLine(panel, lines[4] ?? "", 790, true);
  svg.append(panel);
}

export function serializeSceneSvgForExport(
  replayCase: ReplayCase,
  context: SceneExportContext,
): string {
  if (!Number.isFinite(context.playheadTimeMs)) {
    throw new Error("The scene export playhead must be a finite time.");
  }
  const source = sceneSvgElement();
  const svg = source.cloneNode(true) as SVGSVGElement;
  inlineScenePresentation(source, svg);
  neutralizeTransientSceneState(svg, replayCase);
  appendSceneExportContext(svg, replayCase, context);
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  svg.setAttribute("width", String(SCENE_EXPORT_WIDTH));
  svg.setAttribute("height", String(SCENE_EXPORT_HEIGHT));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", cleanXmlText(`${replayCase.title} scene reconstruction diagram`));
  svg.setAttribute("focusable", "false");
  const serialized = new XMLSerializer().serializeToString(svg);
  const parsed = new DOMParser().parseFromString(serialized, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    throw new Error(
      "The scene contains text or geometry that cannot be represented safely in SVG.",
    );
  }
  return serialized;
}

export function waitForSceneImage(
  image: HTMLImageElement,
  source: string,
  timeoutMs = SCENE_RASTER_TIMEOUT_MS,
): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error("The scene raster timeout must be a positive duration."));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      image.removeAttribute("src");
      reject(new Error("The scene SVG could not be rasterized."));
    };
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    const timer = window.setTimeout(() => {
      cleanup();
      image.removeAttribute("src");
      reject(new Error("The scene SVG rasterization timed out."));
    }, timeoutMs);
    try {
      image.src = source;
    } catch (error) {
      cleanup();
      image.removeAttribute("src");
      reject(new Error("The scene SVG could not be assigned for rasterization.", { cause: error }));
    }
  });
}

async function scenePngBlob(
  serializedSvg: string,
  width: number,
  height: number,
  pixelRatio: number,
): Promise<Blob> {
  const svgUrl = URL.createObjectURL(
    new Blob([serializedSvg], { type: "image/svg+xml;charset=utf-8" }),
  );
  const image = new Image();
  try {
    image.decoding = "sync";
    await waitForSceneImage(image, svgUrl);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not create the scene export canvas.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#d7d4c9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToPngBlob(canvas);
  } finally {
    image.removeAttribute("src");
    URL.revokeObjectURL(svgUrl);
  }
}

export function exportCaseJson(replayCase: ReplayCase): void {
  download(
    new Blob([exportReplayCase(replayCase)], { type: "application/json;charset=utf-8" }),
    `${safeFilename(replayCase.title)}.replay.json`,
  );
}

export function exportSceneSvg(replayCase: ReplayCase, context: SceneExportContext): void {
  download(
    new Blob([serializeSceneSvgForExport(replayCase, context)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    `${safeFilename(replayCase.title)}-scene.svg`,
  );
}

export async function exportScenePng(
  replayCase: ReplayCase,
  context: SceneExportContext,
): Promise<void> {
  const serializedSvg = serializeSceneSvgForExport(replayCase, context);
  const blob = await scenePngBlob(serializedSvg, SCENE_EXPORT_WIDTH, SCENE_EXPORT_HEIGHT, 2);
  download(blob, `${safeFilename(replayCase.title)}-scene.png`);
}

const PDF_CITATION_HANDOFF_KEY =
  "Citation key: Observation record IDs identify recorded statements; evidence item IDs match the Evidence Index; structured case paths locate records in the JSON transfer. The JSON transfer excludes evidence image bytes, and finalized PDFs exclude live scene geometry. Export the current scene separately when needed.";

const PDF_STATIC_TEXT = [
  "REPLAY · FINALIZED FACTUAL SNAPSHOT",
  "REPLAY · DRAFT — NOT FINALIZED",
  "DRAFT — NOT FINALIZED",
  "Nothing recorded.",
  "•",
  "Citation and reviewer handoff key",
  PDF_CITATION_HANDOFF_KEY,
  "Observation record IDs",
  "Evidence item IDs (see Evidence Index)",
  "Structured case paths (see JSON transfer)",
  "Missing requirements before finalization",
  "Human finalization still required",
  "FINALIZED IMMUTABLE SNAPSHOT · ID · snapshot case version · reviewed case version · created.",
  "This preview has not received the required human acknowledgements and must not be represented as an immutable REPLAY report snapshot.",
  "All automated preview requirements are currently present. A human must still review unresolved questions, limitations, confirmed facts, and every included unconfirmed or hypothesis statement, then manually finalize the report.",
  "Scene diagram omitted: this immutable report describes case version, while the open workspace is version. REPLAY will not attach newer live geometry to an older snapshot.",
  "Scene diagram could not be embedded in this export. The structured scene remains available in the separate case JSON export.",
].join("\n");

export function normalizePdfText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}

function reportPdfTextEntries(
  preview: ReportPreview,
  context: ReportPdfExportContext,
  sceneOmissionReason?: string,
): PdfTextEntry[] {
  const entries: PdfTextEntry[] = [
    { label: "REPLAY PDF labels", text: PDF_STATIC_TEXT },
    { label: "report title", text: preview.title },
    { label: "report disclaimer", text: preview.disclaimer },
  ];
  if (sceneOmissionReason) {
    entries.push({ label: "scene omission explanation", text: sceneOmissionReason });
  }
  for (const requirement of preview.missingRequirements) {
    entries.push({ label: "report finalization requirement", text: requirement });
  }
  for (const section of preview.sections) {
    entries.push(
      { label: `report section ${section.id} title`, text: section.title },
      { label: `report section ${section.id} uppercase title`, text: section.title.toUpperCase() },
    );
    for (const statement of section.statements) {
      entries.push(
        { label: `report statement ${statement.id}`, text: statement.text },
        ...statement.citations.claimIds.map((id) => ({
          label: `claim citation in ${statement.id}`,
          text: id,
        })),
        ...statement.citations.evidenceIds.map((id) => ({
          label: `evidence citation in ${statement.id}`,
          text: id,
        })),
        ...statement.citations.workspacePaths.map((path) => ({
          label: `workspace citation in ${statement.id}`,
          text: path,
        })),
      );
    }
  }
  if (context.finalizedSnapshot) {
    entries.push({
      label: "finalized report snapshot id",
      text: context.finalizedSnapshot.id,
    });
  }
  return entries.map((entry) => ({ ...entry, text: normalizePdfText(entry.text) }));
}

export interface ReportSceneExportDecision {
  include: boolean;
  comparisonBranchIds: readonly string[];
  omissionReason?: string | undefined;
}

export function reportSceneExportDecision(
  replayCase: ReplayCase,
  preview: ReportPreview,
  context: ReportPdfExportContext,
): ReportSceneExportDecision {
  const finalizedSnapshot = context.finalizedSnapshot;
  if (!finalizedSnapshot) {
    return preview.caseVersion === replayCase.caseVersion
      ? { include: true, comparisonBranchIds: context.comparisonBranchIds }
      : {
          include: false,
          comparisonBranchIds: [],
          omissionReason: `Scene diagram omitted: this report preview describes case version ${String(preview.caseVersion)}, while the open workspace is version ${String(replayCase.caseVersion)}. REPLAY will not attach newer live geometry to an older preview.`,
        };
  }
  const hasLegacyAccompanyingSceneClaim = preview.sections.some((section) =>
    section.statements.some((statement) => /\bthe accompanying\b/i.test(statement.text)),
  );
  return {
    include: false,
    comparisonBranchIds: [],
    omissionReason: `Scene diagram omitted: finalized snapshot ${finalizedSnapshot.id} does not bind an immutable scene image, active branch, playhead time, or comparison selection. Export a separate scene review snapshot if current live geometry is needed.${hasLegacyAccompanyingSceneClaim ? " This historical snapshot's reference to an accompanying diagram describes separately exportable structured case state; no scene image is attached to this PDF." : ""}`,
  };
}

export async function exportReportPdf(
  replayCase: ReplayCase,
  preview: ReportPreview,
  context: ReportPdfExportContext,
): Promise<void> {
  const finalizedSnapshot = context.finalizedSnapshot;
  if (finalizedSnapshot && JSON.stringify(finalizedSnapshot.preview) !== JSON.stringify(preview)) {
    throw new Error("The selected finalized snapshot does not match the report being exported.");
  }
  const isFinalized = finalizedSnapshot !== undefined;
  const sceneDecision = reportSceneExportDecision(replayCase, preview, context);
  const reportTitle = normalizePdfText(preview.title);
  // Freeze live draft geometry before the first async boundary. Font loading
  // or module evaluation must never let a later playhead/edit state enter an
  // export labeled with the earlier case/context snapshot.
  const serializedScene = sceneDecision.include
    ? serializeSceneSvgForExport(replayCase, {
        ...context,
        comparisonBranchIds: sceneDecision.comparisonBranchIds,
      })
    : undefined;
  const fontResources = await loadPdfFontResources();
  assertPdfGlyphCoverage(
    reportPdfTextEntries(preview, context, sceneDecision.omissionReason),
    fontResources.supportedCodePoints,
  );
  const { jsPDF } = await import("jspdf");
  // Optional HTML/SVG renderer dependencies are intentionally excluded from
  // production. Keep their entry points outside the exporter at compile time.
  const pdf: Omit<InstanceType<typeof jsPDF>, "html" | "addSvgAsImage"> = new jsPDF({
    unit: "mm",
    format: "a4",
    compress: true,
  });
  pdf.addFileToVFS(fontResources.regular.filename, fontResources.regular.base64);
  pdf.addFont(fontResources.regular.filename, fontResources.family, "normal");
  pdf.addFileToVFS(fontResources.bold.filename, fontResources.bold.base64);
  pdf.addFont(fontResources.bold.filename, fontResources.family, "bold");
  const registeredStyles = pdf.getFontList()[fontResources.family];
  if (!registeredStyles?.includes("normal") || !registeredStyles.includes("bold")) {
    throw new Error("The bundled Unicode PDF fonts could not be registered safely.");
  }
  pdf.setProperties({
    title: reportTitle,
    subject: normalizePdfText(
      isFinalized
        ? `Finalized immutable factual snapshot ${finalizedSnapshot.id}`
        : "Draft evidence-bound factual report preview — not finalized",
    ),
    author: "REPLAY",
    creator: "REPLAY",
  });
  const margin = 18;
  const width = 210 - margin * 2;
  const contentBottom = 274;
  let y = 20;

  function addContentPage(): void {
    pdf.addPage();
    y = 20;
  }

  function ensureSpace(height: number): void {
    if (y + height <= contentBottom) return;
    addContentPage();
  }

  function lineHeight(size: number): number {
    return size * 0.47;
  }

  function wrappedLines(text: string, size: number, style: "bold" | "normal" = "normal"): string[] {
    pdf.setFont(PDF_FONT_FAMILY, style);
    pdf.setFontSize(size);
    return pdf.splitTextToSize(normalizePdfText(text), width) as string[];
  }

  function minimumParagraphHeight(text: string, size = 9): number {
    const lines = wrappedLines(text, size);
    return Math.min(Math.max(lines.length, 1), 2) * lineHeight(size) + 3;
  }

  function paragraph(text: string, size = 9, color: [number, number, number] = [51, 62, 63]): void {
    pdf.setFont(PDF_FONT_FAMILY, "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(normalizePdfText(text), width) as string[];
    const height = lineHeight(size);
    let offset = 0;
    while (offset < lines.length) {
      if (y > contentBottom) addContentPage();
      const availableLines = Math.max(1, Math.floor((contentBottom - y) / height) + 1);
      const chunk = lines.slice(offset, offset + availableLines);
      pdf.text(chunk, margin, y, {
        lineHeightFactor: height / (size * 0.352_778),
      });
      y += chunk.length * height;
      offset += chunk.length;
      if (offset < lines.length) addContentPage();
    }
    y += 3;
  }

  function citationList(
    label: string,
    values: readonly string[],
    color: [number, number, number] = [96, 100, 101],
  ): void {
    const chunkSize = 100;
    for (let offset = 0; offset < values.length; offset += chunkSize) {
      const chunk = values.slice(offset, offset + chunkSize);
      paragraph(`${label}${offset === 0 ? "" : " (continued)"}: ${chunk.join(", ")}`, 7, color);
    }
  }

  function sectionHeading(title: string, minimumFollowingHeight: number): void {
    const lines = wrappedLines(title.toUpperCase(), 10, "bold");
    const headingLineHeight = lineHeight(10);
    const headingHeight = 6 + Math.max(lines.length, 1) * headingLineHeight + 3;
    ensureSpace(headingHeight + minimumFollowingHeight);
    pdf.setDrawColor(45, 74, 75);
    pdf.setLineWidth(0.4);
    pdf.line(margin, y, margin + width, y);
    y += 6;
    pdf.setFont(PDF_FONT_FAMILY, "bold");
    pdf.setTextColor(37, 48, 50);
    pdf.setFontSize(10);
    pdf.text(lines, margin, y, {
      lineHeightFactor: headingLineHeight / (10 * 0.352_778),
    });
    y += Math.max(lines.length, 1) * headingLineHeight + 3;
  }

  pdf.setFont(PDF_FONT_FAMILY, "normal");
  let titleSize = 20;
  pdf.setFontSize(titleSize);
  let titleLines = pdf.splitTextToSize(reportTitle, width) as string[];
  let titleLineHeight = titleSize * 0.42;
  while (27 + titleLines.length * titleLineHeight > 228 && titleSize > 12) {
    titleSize -= 1;
    pdf.setFontSize(titleSize);
    titleLines = pdf.splitTextToSize(reportTitle, width) as string[];
    titleLineHeight = titleSize * 0.42;
  }
  pdf.setFont(PDF_FONT_FAMILY, "normal");
  pdf.setFontSize(8);
  const generatedAt = new Date(preview.generatedAt).toISOString();
  const metadata = finalizedSnapshot
    ? `Snapshot ${finalizedSnapshot.id}  ·  Reviewed case version ${preview.caseVersion}  ·  Finalized ${new Date(finalizedSnapshot.createdAt).toISOString()}`
    : `DRAFT — NOT FINALIZED  ·  Case version ${preview.caseVersion}  ·  Generated ${generatedAt}`;
  const metadataLines = pdf.splitTextToSize(normalizePdfText(metadata), width) as string[];
  const titleY = 27;
  const metadataLineHeight = lineHeight(8);
  const metadataY = titleY + Math.max(titleLines.length, 1) * titleLineHeight + 2;
  const headerHeight = Math.max(
    44,
    metadataY + Math.max(metadataLines.length, 1) * metadataLineHeight + 6,
  );

  pdf.setFillColor(38, 68, 69);
  pdf.rect(0, 0, 210, headerHeight, "F");
  pdf.setTextColor(244, 241, 232);
  pdf.setFont(PDF_FONT_FAMILY, "bold");
  pdf.setFontSize(9);
  pdf.text(
    isFinalized ? "REPLAY  ·  FINALIZED FACTUAL SNAPSHOT" : "REPLAY  ·  DRAFT — NOT FINALIZED",
    margin,
    14,
  );
  pdf.setFont(PDF_FONT_FAMILY, "normal");
  pdf.setFontSize(titleSize);
  pdf.text(titleLines, margin, titleY, {
    lineHeightFactor: titleLineHeight / (titleSize * 0.352_778),
  });
  pdf.setFont(PDF_FONT_FAMILY, "normal");
  pdf.setFontSize(8);
  pdf.text(metadataLines, margin, metadataY, {
    lineHeightFactor: metadataLineHeight / (8 * 0.352_778),
  });
  y = headerHeight + 11;

  if (finalizedSnapshot) {
    paragraph(
      `FINALIZED IMMUTABLE SNAPSHOT · ID ${finalizedSnapshot.id} · snapshot case version ${String(finalizedSnapshot.caseVersion)} · reviewed case version ${String(preview.caseVersion)} · created ${new Date(finalizedSnapshot.createdAt).toISOString()}.`,
      8,
      [40, 94, 79],
    );
  } else {
    paragraph(
      "DRAFT — NOT FINALIZED. This preview has not received the required human acknowledgements and must not be represented as an immutable REPLAY report snapshot.",
      9,
      [142, 54, 45],
    );
    sectionHeading(
      preview.missingRequirements.length > 0
        ? "Missing requirements before finalization"
        : "Human finalization still required",
      10,
    );
    if (preview.missingRequirements.length > 0) {
      for (const requirement of preview.missingRequirements) paragraph(`• ${requirement}`, 8);
    } else {
      paragraph(
        "All automated preview requirements are currently present. A human must still review unresolved questions, limitations, confirmed facts, and every included unconfirmed or hypothesis statement, then manually finalize the report.",
        8,
      );
    }
  }

  if (!sceneDecision.include) {
    paragraph(
      sceneDecision.omissionReason ?? "Scene diagram omitted for snapshot integrity.",
      8,
      [100, 100, 100],
    );
  } else {
    try {
      const scenePng = await scenePngBlob(
        serializedScene ?? "",
        SCENE_EXPORT_WIDTH,
        SCENE_EXPORT_HEIGHT,
        1.5,
      );
      const scenePngBytes = new Uint8Array(await scenePng.arrayBuffer());
      const sceneHeight = width * (SCENE_EXPORT_HEIGHT / SCENE_EXPORT_WIDTH);
      ensureSpace(sceneHeight + 7);
      pdf.addImage(scenePngBytes, "PNG", margin, y, width, sceneHeight, undefined, "FAST");
      y += sceneHeight + 7;
    } catch {
      paragraph(
        "Scene diagram could not be embedded in this export. The structured scene remains available in the separate case JSON export.",
        8,
        [100, 100, 100],
      );
    }
  }

  sectionHeading(
    "Citation and reviewer handoff key",
    minimumParagraphHeight(PDF_CITATION_HANDOFF_KEY, 8),
  );
  paragraph(PDF_CITATION_HANDOFF_KEY, 8, [77, 82, 83]);

  for (const section of preview.sections) {
    const firstStatement = section.statements[0];
    const firstContent = firstStatement
      ? `${firstStatement.text} (${firstStatement.certainty})`
      : "Nothing recorded.";
    sectionHeading(section.title, minimumParagraphHeight(firstContent, firstStatement ? 9 : 8));
    if (section.statements.length === 0) {
      paragraph("Nothing recorded.", 8, [105, 105, 105]);
      continue;
    }
    for (const statement of section.statements) {
      paragraph(`${statement.text} (${statement.certainty})`, 9);
      const citationGroups = [
        ["Observation record IDs", statement.citations.claimIds],
        ["Evidence item IDs (see Evidence Index)", statement.citations.evidenceIds],
        ["Structured case paths (see JSON transfer)", statement.citations.workspacePaths],
      ] as const;
      for (const [label, values] of citationGroups) {
        citationList(label, values);
      }
    }
    y += 2;
  }

  ensureSpace(18);
  pdf.setFillColor(235, 233, 224);
  pdf.rect(margin, y, width, 1, "F");
  y += 8;
  paragraph(preview.disclaimer, 8, [77, 82, 83]);

  const pageCount = pdf.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pdf.setPage(pageNumber);
    if (!isFinalized) {
      pdf.setFont(PDF_FONT_FAMILY, "bold");
      pdf.setFontSize(24);
      pdf.setTextColor(235, 210, 207);
      pdf.text("DRAFT — NOT FINALIZED", 105, 151, { align: "center", angle: 35 });
    }
    pdf.setDrawColor(216, 214, 206);
    pdf.setLineWidth(0.25);
    pdf.line(margin, 283, margin + width, 283);
    pdf.setFont(PDF_FONT_FAMILY, "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(96, 100, 101);
    pdf.text(
      normalizePdfText(
        finalizedSnapshot
          ? `REPLAY  ·  FINALIZED SNAPSHOT ${finalizedSnapshot.id}`
          : "REPLAY  ·  DRAFT — NOT FINALIZED",
      ),
      margin,
      288,
    );
    pdf.text(`${String(pageNumber)} / ${String(pageCount)}`, margin + width, 288, {
      align: "right",
    });
  }
  pdf.save(
    finalizedSnapshot
      ? `${safeFilename(preview.title)}-finalized-${safeFilename(finalizedSnapshot.id)}.pdf`
      : `${safeFilename(replayCase.title)}-draft-factual-report.pdf`,
  );
}
