import { readFile } from "node:fs/promises";

import { expect, test, type Download, type Page } from "@playwright/test";

import { inspectorTab, openDemo, waitForImages } from "./helpers";

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error(`Playwright did not retain ${download.suggestedFilename()}.`);
  return readFile(path);
}

async function decodedImageMetrics(
  page: Page,
  source: string,
): Promise<{ centerPixel: number[]; height: number; width: number }> {
  return page.evaluate(
    (imageSource) =>
      new Promise<{ centerPixel: number[]; height: number; width: number }>((resolve, reject) => {
        const image = new Image();
        image.addEventListener(
          "load",
          () => {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) {
              reject(new Error("Browser could not inspect the decoded export."));
              return;
            }
            context.drawImage(image, 0, 0);
            resolve({
              width: image.naturalWidth,
              height: image.naturalHeight,
              centerPixel: Array.from(
                context.getImageData(
                  Math.floor(image.naturalWidth / 2),
                  Math.floor(image.naturalHeight / 2),
                  1,
                  1,
                ).data,
              ),
            });
          },
          { once: true },
        );
        image.addEventListener(
          "error",
          () => reject(new Error("Browser could not decode export.")),
          {
            once: true,
          },
        );
        image.src = imageSource;
      }),
    source,
  );
}

test.describe("cross-browser release smoke", () => {
  test("boots the configured base path and produces portable scene exports", async ({
    page,
  }, testInfo) => {
    test.slow();
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
      if (message.type() === "warning") consoleWarnings.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
      );
    });

    try {
      await openDemo(page);
    } catch (error) {
      const bootError = error instanceof Error ? error : new Error(String(error));
      throw new Error(
        [
          bootError.message,
          `URL: ${page.url()}`,
          `Console errors: ${consoleErrors.join(" | ") || "none"}`,
          `Console warnings: ${consoleWarnings.join(" | ") || "none"}`,
          `Page errors: ${pageErrors.join(" | ") || "none"}`,
          `Failed requests: ${failedRequests.join(" | ") || "none"}`,
        ].join("\n"),
        { cause: error },
      );
    }
    const configuredBaseUrl = new URL(String(testInfo.project.use.baseURL));
    expect(new URL(page.url()).pathname).toBe(configuredBaseUrl.pathname);
    await inspectorTab(page, "Evidence").click();
    await waitForImages(page);
    await expect(page.locator(".save-status")).toContainText("Saved locally");

    const assetHealth = await page.locator("img").evaluateAll((images) => ({
      assets: images.map((image) => {
        const element = image as HTMLImageElement;
        return { source: element.currentSrc, width: element.naturalWidth };
      }),
      origin: window.location.origin,
    }));
    expect(assetHealth.assets.length).toBeGreaterThan(0);
    expect(assetHealth.assets.every((asset) => asset.width > 0)).toBe(true);
    expect(
      assetHealth.assets.every((asset) => new URL(asset.source).origin === assetHealth.origin),
    ).toBe(true);

    await inspectorTab(page, "Report").click();
    const [svgDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "SVG", exact: true }).click(),
    ]);
    const svgBytes = await downloadedBytes(svgDownload);
    await testInfo.attach("scene-export.svg", {
      body: svgBytes,
      contentType: "image/svg+xml",
    });
    const svg = svgBytes.toString("utf8");
    const svgValidation = await page.evaluate((source) => {
      const document = new DOMParser().parseFromString(source, "image/svg+xml");
      return {
        namespace: document.documentElement.namespaceURI,
        parserErrors: document.querySelectorAll("parsererror").length,
        scripts: document.querySelectorAll("script, foreignObject").length,
      };
    }, svg);
    expect(svgValidation).toEqual({
      namespace: "http://www.w3.org/2000/svg",
      parserErrors: 0,
      scripts: 0,
    });
    expect(svg).toContain('data-replay-export-context="review-snapshot"');
    expect(svg).toContain("Not a simulation or proof of physical contact");
    expect(svg).not.toMatch(/(?:href|src)=["'](?:https?:|\/\/|\/)/i);
    expect(svg).not.toMatch(/\b(?:oklch|oklab|lab|lch)\(/i);
    const svgMetrics = await decodedImageMetrics(
      page,
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    );
    expect(svgMetrics).toMatchObject({ width: 1600, height: 1280 });
    expect(svgMetrics.centerPixel[3]).toBe(255);
    expect(Math.max(...svgMetrics.centerPixel.slice(0, 3))).toBeGreaterThan(24);

    const [pngDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PNG", exact: true }).click(),
    ]);
    const png = await downloadedBytes(pngDownload);
    await testInfo.attach("scene-export.png", { body: png, contentType: "image/png" });
    expect(png.byteLength).toBeGreaterThan(1_000);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const pngMetrics = await decodedImageMetrics(
      page,
      `data:image/png;base64,${png.toString("base64")}`,
    );
    expect(pngMetrics).toMatchObject({ width: 3200, height: 2560 });
    expect(pngMetrics.centerPixel[3]).toBe(255);
    expect(Math.max(...pngMetrics.centerPixel.slice(0, 3))).toBeGreaterThan(24);

    const unexpectedConsoleWarnings = consoleWarnings.filter(
      (message) =>
        !/^Error with Permissions-Policy header: Origin trial controlled feature not enabled: 'tools'\.$/.test(
          message,
        ),
    );
    expect(consoleErrors).toEqual([]);
    expect(unexpectedConsoleWarnings).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
