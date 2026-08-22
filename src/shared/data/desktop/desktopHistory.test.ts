import {
  hasDesktopHostBridge,
  postDesktopHostMessage,
} from "@/shared/data/desktop/desktopHostBridge";
import { requestDesktopHistoryOpenChat } from "@/shared/data/desktop/desktopHistory";
import { isDesktopAppMode } from "@/shared/utils/routing";

jest.mock("@/shared/data/desktop/desktopHostBridge", () => ({
  hasDesktopHostBridge: jest.fn(),
  postDesktopHostMessage: jest.fn(),
}));

jest.mock("@/shared/utils/routing", () => ({
  isDesktopAppMode: jest.fn(),
}));

describe("Desktop history bridge", () => {
  const originalWindow = global.window;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(global, "window", {
      configurable: true,
      value: {},
    });
    jest.mocked(isDesktopAppMode).mockReturnValue(true);
    jest.mocked(hasDesktopHostBridge).mockReturnValue(true);
    jest.mocked(postDesktopHostMessage).mockReturnValue(true);
  });

  afterAll(() => {
    Object.defineProperty(global, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("sends the selected Chat identity to Desktop", () => {
    expect(
      requestDesktopHistoryOpenChat({
        agentKey: " demo-agent ",
        chatId: " chat-1 ",
      }),
    ).toBe(true);
    expect(postDesktopHostMessage).toHaveBeenCalledWith({
      type: "desktop:agent-webclient:history-open-chat",
      requestId: expect.stringMatching(/^desktop_history_/u),
      agentKey: "demo-agent",
      chatId: "chat-1",
    });
  });

  it("falls back to router navigation outside Desktop", () => {
    jest.mocked(isDesktopAppMode).mockReturnValue(false);
    expect(
      requestDesktopHistoryOpenChat({ agentKey: "demo-agent", chatId: "chat-1" }),
    ).toBe(false);
    expect(postDesktopHostMessage).not.toHaveBeenCalled();
  });
});
