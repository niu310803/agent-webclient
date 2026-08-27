import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDesktopHtmlPreviewDocument } from "@/features/viewers/hooks/useDesktopHtmlPreviewReview";

describe("Desktop HTML preview review bridge", () => {
  it("injects the bridge before artifact CSP while preserving the document", () => {
    const source = "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'\"></head><body><main>Dashboard</main></body></html>";
    const result = buildDesktopHtmlPreviewDocument(
      source,
      "artifacts/run_01/dashboard.html",
      "review-token",
    );

    expect(result).toContain("<base href=\"artifacts/run_01/dashboard.html\">");
    expect(result).toContain("__zenmindDesktopHtmlReviewAction");
    expect(result).toContain("document.elementsFromPoint");
    expect(result).toContain("<main>Dashboard</main>");
    expect(result.indexOf("__zenmindDesktopHtmlReviewAction")).toBeLessThan(
      result.indexOf("Content-Security-Policy"),
    );
  });

  it("wraps an HTML fragment without granting same-origin sandbox access", () => {
    const result = buildDesktopHtmlPreviewDocument(
      "<section>Summary</section>",
      "",
      "review-token",
    );

    expect(result).toMatch(/^<!doctype html><html><head><script>/u);
    expect(result).toContain("<body><section>Summary</section></body>");
    expect(result).not.toContain("allow-same-origin");
  });

  it("publishes edit capability before the srcDoc iframe load completes", () => {
    const source = readFileSync(
      join(__dirname, "useDesktopHtmlPreviewReview.ts"),
      "utf8",
    );

    expect(source).toContain("const available = current.enabled && current.html !== null;");
    expect(source).not.toContain("current.html !== null && loadedRef.current");
    expect(source).toContain("emitCapability(`available-${Date.now()}`);");
  });
});
