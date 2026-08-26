import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Desktop Resource Viewer image review", () => {
  it("observes image load before requiring natural dimensions for capability", () => {
    const source = readFileSync(
      join(__dirname, "useDesktopImagePreviewReview.ts"),
      "utf8",
    );
    expect(source).toContain("findDesktopReviewImageElement(host, false)");
    expect(source).toContain('observedImage?.addEventListener("load", onLoad);');
    expect(source).toContain("if (!(event.target instanceof HTMLImageElement)) return;");
    expect(source).not.toContain('imageElement(host)?.addEventListener("load"');
  });
});
