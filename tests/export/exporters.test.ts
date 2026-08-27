import { describe, expect, it } from "vitest";

import { pngDataUrlToBlob } from "../../src/export/exporters";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

describe("PNG data URL conversion", () => {
  it("decodes a Base64 PNG without a network request", async () => {
    const blob = pngDataUrlToBlob(`data:image/png;base64,${ONE_PIXEL_PNG}`);

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(8);
    expect(Array.from(new Uint8Array(await readBlob(blob)).slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
  });

  it.each([
    ["not a data URL", "Scene PNG export returned an invalid data URL."],
    ["data:image/jpeg;base64,/9j/2Q==", "Scene PNG export returned an unexpected media type."],
    ["data:image/png,plain-text", "Scene PNG export returned a non-Base64 data URL."],
    ["data:image/png;base64,%%%%", "Scene PNG export returned an invalid Base64 payload."],
    ["data:image/png;base64,QUJDRA==", "Scene PNG export returned invalid PNG data."],
  ])("rejects malformed output %#", (dataUrl, message) => {
    expect(() => pngDataUrlToBlob(dataUrl)).toThrow(message);
  });
});
