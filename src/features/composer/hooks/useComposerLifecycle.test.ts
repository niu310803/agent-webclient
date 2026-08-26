import { appendDesktopReviewDraft } from "@/features/composer/hooks/useComposerLifecycle";

describe("WorkPanel Composer draft handoff", () => {
  it("fills an empty Composer and appends to existing content without overwriting it", () => {
    expect(appendDesktopReviewDraft("", "review")).toBe("review");
    expect(appendDesktopReviewDraft("   ", "review")).toBe("review");
    expect(appendDesktopReviewDraft("existing", "review")).toBe(
      "existing\n\n---\n\nreview",
    );
  });
});
