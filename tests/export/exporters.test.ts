import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoCase } from "../../src/domain";
import {
  canvasToPngBlob,
  serializeSceneSvgForExport,
  waitForSceneImage,
} from "../../src/export/exporters";

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer), { once: true });
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Could not read the generated PNG blob.")),
      { once: true },
    );
    reader.readAsArrayBuffer(blob);
  });
}

describe("bounded PNG canvas encoding", () => {
  it("returns a signature-checked PNG blob without Base64 amplification", async () => {
    const encoded = new Blob([PNG_BYTES], { type: "image/png" });
    const canvas = {
      toBlob(callback: BlobCallback): void {
        callback(encoded);
      },
    } as unknown as HTMLCanvasElement;
    const blob = await canvasToPngBlob(canvas);

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(8);
    expect(Array.from(new Uint8Array(await readBlob(blob)).slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
  });

  it("rejects an encoder that returns no bytes", async () => {
    const canvas = {
      toBlob(callback: BlobCallback): void {
        callback(null);
      },
    } as unknown as HTMLCanvasElement;
    await expect(canvasToPngBlob(canvas)).rejects.toThrow(
      "The browser could not encode the scene as PNG.",
    );
  });

  it("rejects mislabeled or malformed encoder output", async () => {
    const canvas = {
      toBlob(callback: BlobCallback): void {
        callback(new Blob(["not-png"], { type: "image/jpeg" }));
      },
    } as unknown as HTMLCanvasElement;
    await expect(canvasToPngBlob(canvas)).rejects.toThrow(
      "Scene PNG export returned an unexpected media type.",
    );
  });
});

describe("review-scene export", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exports a full-scene review snapshot with visible context and no edit affordances", () => {
    document.body.innerHTML = `
      <svg class="scene-svg is-placing-impact" viewBox="250 150 450 315" xmlns="http://www.w3.org/2000/svg">
        <defs><filter id="shadow"><feGaussianBlur stdDeviation="2" /></filter></defs>
        <g class="placement-grid"><path d="M0 0L10 10" /></g>
        <g class="trajectory is-selected is-agent-authored">
          <path class="trajectory__hit" d="M0 0L100 100" role="button" tabindex="0" />
          <path class="trajectory__line" d="M0 0L100 100" style="stroke-width: 8" />
          <circle class="trajectory__handle-hit" r="34" />
          <circle class="trajectory__handle is-active" r="11" />
          <text class="trajectory__handle-number">1</text>
          <text class="path-marker-label">START</text>
        </g>
        <g class="scene-vehicle is-selected is-agent-active is-unverified-imported-proposal" role="button" tabindex="0">
          <polygon class="vehicle-selection" points="0,0 2,0 2,2" />
          <g class="vehicle-rotation-control"><circle r="10" /></g>
          <text class="vehicle-label">Vehicle A</text>
        </g>
        <g class="impact-marker is-selected" transform="translate(100 100) scale(0.45)">
          <circle r="8" />
          <text>Selected impact</text>
        </g>
        <g class="contact-geometry-marker" transform="translate(110 110) scale(0.45)" />
        <g class="proposal-scene-path"><path d="M4 4L8 8" /></g>
      </svg>`;
    const replayCase = createDemoCase();

    const serialized = serializeSceneSvgForExport(replayCase, {
      playheadTimeMs: 3_250,
      comparisonBranchIds: [],
    });
    const parsed = new DOMParser().parseFromString(serialized, "image/svg+xml");
    const svg = parsed.documentElement;
    const contextPanel = svg.querySelector('[data-replay-export-context="review-snapshot"]');

    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 800");
    expect(svg.getAttribute("width")).toBe("1600");
    expect(svg.getAttribute("height")).toBe("1280");
    expect(svg.getAttribute("role")).toBe("img");
    expect(Number(contextPanel?.querySelector("rect")?.getAttribute("y"))).toBeGreaterThanOrEqual(
      700,
    );
    expect(contextPanel?.textContent).toContain("REVIEW SNAPSHOT");
    expect(contextPanel?.textContent).toContain("Case v1");
    expect(contextPanel?.textContent).toContain("Playhead: 3.250 s");
    expect(contextPanel?.textContent).toContain("case-wide");
    expect(contextPanel?.textContent).toContain("1 unverified import");
    expect(contextPanel?.textContent).toContain("Not a simulation");
    expect(svg.querySelector(".is-selected")).toBeNull();
    expect(svg.querySelector(".is-agent-active")).toBeNull();
    expect(
      svg.querySelector<SVGElement>(".scene-vehicle .vehicle-selection")?.style.stroke,
    ).not.toBe("rgba(0, 0, 0, 0)");
    expect(svg.classList.contains("is-placing-impact")).toBe(false);
    expect(
      svg.querySelector(
        ".placement-grid, .trajectory__hit, .trajectory__handle, .trajectory__handle-number, .path-marker-label, .vehicle-rotation-control, .vehicle-label",
      ),
    ).toBeNull();
    expect(svg.querySelector(".impact-marker")?.getAttribute("transform")).toContain("scale(1)");
    expect(svg.querySelector(".contact-geometry-marker")?.getAttribute("transform")).toContain(
      "scale(1)",
    );
    expect(svg.querySelector(".impact-marker title")?.textContent).toContain("event-impact");
  });

  it("identifies every visible impact when the scene contains more than three", () => {
    const replayCase = createDemoCase();
    const sourceImpact = replayCase.timelineEvents.find((event) => event.type === "impact");
    if (!sourceImpact) throw new Error("The seeded case has no impact event.");
    for (let index = 2; index <= 5; index += 1) {
      replayCase.timelineEvents.push({
        ...structuredClone(sourceImpact),
        id: `event-impact-${String(index)}`,
        title: `Approximate contact ${String(index)}`,
        timeMs: sourceImpact.timeMs + index * 100,
        location: { x: sourceImpact.location?.x ?? 50, y: sourceImpact.location?.y ?? 50 },
      });
    }
    document.body.innerHTML = `<svg class="scene-svg" xmlns="http://www.w3.org/2000/svg">${replayCase.timelineEvents
      .filter((event) => event.type === "impact" && event.location)
      .map(
        () =>
          '<g class="impact-marker" transform="translate(100 100) scale(0.5)" aria-label="interactive impact"><circle r="9" /></g>',
      )
      .join("")}</svg>`;

    const serialized = serializeSceneSvgForExport(replayCase, {
      playheadTimeMs: 10_500,
      comparisonBranchIds: [],
    });
    const parsed = new DOMParser().parseFromString(serialized, "image/svg+xml");
    const markers = [...parsed.querySelectorAll<SVGGElement>(".impact-marker")];

    expect(markers).toHaveLength(5);
    expect(markers.map((marker) => marker.dataset.replayImpactId)).toEqual([
      "event-impact",
      "event-impact-2",
      "event-impact-3",
      "event-impact-4",
      "event-impact-5",
    ]);
    expect(markers.every((marker) => marker.querySelector("title")?.textContent)).toBe(true);
    expect(
      markers.map((marker) => marker.querySelector(".replay-export-impact-label")?.textContent),
    ).toEqual([
      "I1 · 10.0 s · uncertain",
      "I2 · 10.2 s · uncertain",
      "I3 · 10.3 s · uncertain",
      "I4 · 10.4 s · uncertain",
      "I5 · 10.5 s · uncertain",
    ]);
    expect(
      parsed.querySelector('[data-replay-export-context="review-snapshot"]')?.textContent,
    ).toContain("Impacts (5): uncertain 5");
    expect(parsed.querySelector("desc")?.textContent).toContain("[event-impact-5]");
    expect(parsed.querySelector("desc")?.textContent).toContain("Approximate contact 5");
  });

  it("truncates context by Unicode code point without creating a replacement glyph", () => {
    const replayCase = createDemoCase();
    const compared = structuredClone(replayCase.branches[0]);
    if (!compared) throw new Error("The seeded case has no branch.");
    compared.id = "branch-unicode-comparison";
    compared.name = `${"a".repeat(30)}🚗x`;
    replayCase.branches.push(compared);
    document.body.innerHTML = '<svg class="scene-svg" xmlns="http://www.w3.org/2000/svg" />';

    const serialized = serializeSceneSvgForExport(replayCase, {
      playheadTimeMs: 0,
      comparisonBranchIds: [compared.id],
    });
    const parsed = new DOMParser().parseFromString(serialized, "image/svg+xml");

    expect(parsed.documentElement.textContent).toContain(compared.name);
    expect(serialized).not.toContain("�");
  });

  it("reports comparison overflow explicitly even when names are truncated", () => {
    const replayCase = createDemoCase();
    const sourceBranch = replayCase.branches[0];
    if (!sourceBranch) throw new Error("The seeded case has no branch.");
    const comparisonIds = Array.from({ length: 5 }, (_, index) => {
      const branch = structuredClone(sourceBranch);
      branch.id = `branch-comparison-${String(index + 1)}`;
      branch.name = `Comparison ${String(index + 1)}`;
      replayCase.branches.push(branch);
      return branch.id;
    });
    document.body.innerHTML = '<svg class="scene-svg" xmlns="http://www.w3.org/2000/svg" />';

    const serialized = serializeSceneSvgForExport(replayCase, {
      playheadTimeMs: 0,
      comparisonBranchIds: comparisonIds,
    });
    const parsed = new DOMParser().parseFromString(serialized, "image/svg+xml");
    const contextText = parsed.querySelector(
      '[data-replay-export-context="review-snapshot"]',
    )?.textContent;

    expect(contextText).toContain("5 total, showing 3 · +2 more");
    expect(contextText).toContain("Comparison 1");
  });

  it("keeps impact labels inside every scene corner", () => {
    const replayCase = createDemoCase();
    replayCase.environment.bounds = { minX: -50, minY: 200, maxX: 150, maxY: 500 };
    const sourceImpact = replayCase.timelineEvents.find((event) => event.type === "impact");
    if (!sourceImpact) throw new Error("The seeded case has no impact event.");
    const corners = [
      { id: "event-corner-top-left", x: -48, y: 203, viewX: 10, viewY: 7 },
      { id: "event-corner-top-right", x: 148, y: 203, viewX: 990, viewY: 7 },
      { id: "event-corner-bottom-left", x: -48, y: 497, viewX: 10, viewY: 693 },
      { id: "event-corner-bottom-right", x: 148, y: 497, viewX: 990, viewY: 693 },
    ] as const;
    replayCase.timelineEvents = replayCase.timelineEvents.filter(
      (event) => event.type !== "impact",
    );
    replayCase.timelineEvents.push(
      ...corners.map(({ id, x, y }, index) => ({
        ...structuredClone(sourceImpact),
        id,
        timeMs: 10_000 + index * 100,
        location: { x, y },
      })),
    );
    document.body.innerHTML = `<svg class="scene-svg" xmlns="http://www.w3.org/2000/svg">${corners
      .map(
        ({ viewX, viewY }) =>
          `<g class="impact-marker" transform="translate(${String(viewX)} ${String(viewY)}) scale(0.5)"><circle r="9" /></g>`,
      )
      .join("")}</svg>`;

    const parsed = new DOMParser().parseFromString(
      serializeSceneSvgForExport(replayCase, {
        playheadTimeMs: 10_300,
        comparisonBranchIds: [],
      }),
      "image/svg+xml",
    );
    const labels = [...parsed.querySelectorAll<SVGTextElement>(".replay-export-impact-label")];

    expect(
      labels.map((label) => [
        label.getAttribute("x"),
        label.getAttribute("y"),
        label.getAttribute("text-anchor"),
      ]),
    ).toEqual([
      ["32", "32", "start"],
      ["-32", "32", "end"],
      ["32", "-20", "start"],
      ["-32", "-20", "end"],
    ]);
  });

  it("bounds raster image loading and removes listeners and source after timeout", async () => {
    vi.useFakeTimers();
    const image = document.createElement("img");
    const removeListener = vi.spyOn(image, "removeEventListener");
    const outcome = expect(waitForSceneImage(image, "blob:scene-export", 25)).rejects.toThrow(
      "rasterization timed out",
    );

    await vi.advanceTimersByTimeAsync(25);
    await outcome;

    expect(image.hasAttribute("src")).toBe(false);
    expect(removeListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("cleans up when the browser rejects the raster source synchronously", async () => {
    const image = document.createElement("img");
    const removeListener = vi.spyOn(image, "removeEventListener");
    Object.defineProperty(image, "src", {
      configurable: true,
      set() {
        throw new DOMException("Rejected test source", "EncodingError");
      },
    });

    await expect(waitForSceneImage(image, "blob:scene-export", 25)).rejects.toThrow(
      "could not be assigned",
    );

    expect(image.hasAttribute("src")).toBe(false);
    expect(removeListener).toHaveBeenCalledWith("load", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
