import { describe, expect, it } from "vitest";

import { isSharedGitHubPagesHostname } from "../../src/privacy/sharedOrigin";

describe("shared public-origin detection", () => {
  it.each([
    ["artem-musii.github.io", true],
    ["ARTEM-MUSII.GITHUB.IO.", true],
    ["github.io", false],
    ["replay.example.com", false],
    ["localhost", false],
  ])("classifies %s", (hostname, expected) => {
    expect(isSharedGitHubPagesHostname(hostname)).toBe(expected);
  });
});
