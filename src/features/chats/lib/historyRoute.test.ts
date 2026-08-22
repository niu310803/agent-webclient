import {
  readInitialHistoryOwnerKey,
  resolveLoadedHistoryOwnerKey,
} from "@/features/chats/lib/historyRoute";

describe("history route filters", () => {
  it("keeps Chats history global when agentKey is missing", () => {
    expect(readInitialHistoryOwnerKey(new URLSearchParams())).toBe("all");
  });

  it("uses agentKey as an initial Projects filter", () => {
    expect(
      readInitialHistoryOwnerKey(new URLSearchParams("agentKey=demo-agent")),
    ).toBe("agent:demo-agent");
  });

  it("waits for both history sources before validating the requested agent", () => {
    expect(
      resolveLoadedHistoryOwnerKey({
        ownerKey: "agent:demo-agent",
        ownerOptions: [],
        loading: true,
      }),
    ).toBe("agent:demo-agent");
  });

  it("falls back to All after an unknown agent finishes loading", () => {
    expect(
      resolveLoadedHistoryOwnerKey({
        ownerKey: "agent:missing",
        ownerOptions: [],
        loading: false,
      }),
    ).toBe("all");
  });
});
