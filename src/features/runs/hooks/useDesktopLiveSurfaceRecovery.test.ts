import { recoverDesktopLiveSurface } from "@/features/runs/hooks/useDesktopLiveSurfaceRecovery";

describe("recoverDesktopLiveSurface", () => {
  it("forces HTTP replay when an active Desktop surface has a current chat", async () => {
    const loadChat = jest.fn().mockResolvedValue(undefined);

    await expect(recoverDesktopLiveSurface({
      active: true,
      chatId: " chat-1 ",
      routeChatId: "chat-1",
      loadChat,
    })).resolves.toBe(true);

    expect(loadChat).toHaveBeenCalledWith("chat-1", {
      forceReload: true,
      focusComposerOnComplete: false,
    });
  });

  it("does not replay or attach while inactive or without a current chat", async () => {
    const loadChat = jest.fn().mockResolvedValue(undefined);

    await expect(recoverDesktopLiveSurface({
      active: false,
      chatId: "chat-1",
      routeChatId: "chat-1",
      loadChat,
    })).resolves.toBe(false);
    await expect(recoverDesktopLiveSurface({
      active: true,
      chatId: "",
      routeChatId: "",
      loadChat,
    })).resolves.toBe(false);

    expect(loadChat).not.toHaveBeenCalled();
  });

  it("does not restore stale state while the Desktop route is switching chats", async () => {
    const loadChat = jest.fn().mockResolvedValue(undefined);

    await expect(recoverDesktopLiveSurface({
      active: true,
      chatId: "chat-old",
      routeChatId: "chat-new",
      loadChat,
    })).resolves.toBe(false);
    await expect(recoverDesktopLiveSurface({
      active: true,
      chatId: "chat-old",
      routeChatId: "",
      loadChat,
    })).resolves.toBe(false);

    expect(loadChat).not.toHaveBeenCalled();
  });
});
