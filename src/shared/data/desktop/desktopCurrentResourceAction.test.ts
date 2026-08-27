import {
  DESKTOP_CURRENT_RESOURCE_ACTION_REQUEST_TYPE,
  DESKTOP_CURRENT_RESOURCE_ACTION_RESPONSE_TYPE,
  checkDesktopCurrentResourceActionsAvailable,
  detectDesktopFileManager,
  requestDesktopCurrentResourceAction,
  resolveDesktopCurrentResourceIdentity,
} from "@/shared/data/desktop/desktopCurrentResourceAction";

const globalWithRuntimeConfig = globalThis as typeof globalThis & {
  __AGENT_WEBCLIENT_RUNTIME_CONFIG__?: Record<string, unknown>;
};

describe("desktop current resource action bridge", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    delete globalWithRuntimeConfig.__AGENT_WEBCLIENT_RUNTIME_CONFIG__;
    if (originalWindow) {
      (globalThis as unknown as { window?: Window & typeof globalThis }).window =
        originalWindow;
    }
    jest.restoreAllMocks();
  });

  function installDesktopWindow(
    respond: (
      payload: Record<string, string>,
      emit: (data: Record<string, unknown>) => void,
    ) => void,
  ) {
    const listeners = new Set<(event: MessageEvent) => void>();
    const mockWindow: any = {
      location: { pathname: "/resource-viewer/demo", search: "" },
      parent: null,
      postMessage: jest.fn((payload: Record<string, string>) => {
        respond(payload, emit);
      }),
      addEventListener: jest.fn((type: string, listener: EventListener) => {
        if (type === "message") {
          listeners.add(listener as unknown as (event: MessageEvent) => void);
        }
      }),
      removeEventListener: jest.fn((type: string, listener: EventListener) => {
        if (type === "message") {
          listeners.delete(listener as unknown as (event: MessageEvent) => void);
        }
      }),
      setTimeout,
      clearTimeout,
      __DESKTOP_WEBVIEW_BRIDGE__: true,
    };
    const emit = (data: Record<string, unknown>) => {
      for (const listener of listeners) {
        listener({ source: mockWindow, data } as MessageEvent);
      }
    };
    mockWindow.parent = mockWindow;
    (globalThis as unknown as { window?: typeof mockWindow }).window = mockWindow;
    globalWithRuntimeConfig.__AGENT_WEBCLIENT_RUNTIME_CONFIG__ = {
      DESKTOP_APP: true,
    };
    return { listeners, mockWindow };
  }

  const resource = {
    chatId: "chat-72",
    profile: "artifact" as const,
    relativePath: "artifacts/run-1/report.docx",
  };

  it("requests the action without exposing an absolute file path", async () => {
    const desktop = installDesktopWindow((payload, emit) => {
      queueMicrotask(() => emit({
        type: DESKTOP_CURRENT_RESOURCE_ACTION_RESPONSE_TYPE,
        requestId: payload.requestId,
        ok: true,
      }));
    });

    await expect(requestDesktopCurrentResourceAction("reveal", resource)).resolves.toEqual({
      ok: true,
    });
    expect(desktop.mockWindow.postMessage).toHaveBeenCalledWith({
      type: DESKTOP_CURRENT_RESOURCE_ACTION_REQUEST_TYPE,
      requestId: expect.any(String),
      action: "reveal",
      ...resource,
    }, "*");
    const request = desktop.mockWindow.postMessage.mock.calls[0][0];
    expect(request).not.toHaveProperty("path");
    expect(request.relativePath.startsWith("/")).toBe(false);
    expect(desktop.listeners.size).toBe(0);
  });

  it("returns the host's safe localized failure", async () => {
    installDesktopWindow((payload, emit) => {
      queueMicrotask(() => emit({
        type: DESKTOP_CURRENT_RESOURCE_ACTION_RESPONSE_TYPE,
        requestId: payload.requestId,
        ok: false,
        code: "not_found",
        message: "文档不存在或已被移动。",
      }));
    });

    await expect(requestDesktopCurrentResourceAction("open-default", resource)).resolves.toEqual({
      ok: false,
      code: "not_found",
      message: "文档不存在或已被移动。",
    });
  });

  it("uses a pathless capability handshake before showing the actions", async () => {
    const desktop = installDesktopWindow((payload, emit) => {
      queueMicrotask(() => emit({
        type: DESKTOP_CURRENT_RESOURCE_ACTION_RESPONSE_TYPE,
        requestId: payload.requestId,
        ok: true,
        available: true,
      }));
    });

    await expect(checkDesktopCurrentResourceActionsAvailable(resource)).resolves.toBe(true);
    expect(desktop.mockWindow.postMessage).toHaveBeenCalledWith({
      type: DESKTOP_CURRENT_RESOURCE_ACTION_REQUEST_TYPE,
      requestId: expect.any(String),
      action: "capabilities",
      ...resource,
    }, "*");
  });

  it("rejects outside Desktop mode", async () => {
    (globalThis as unknown as { window?: { location: { pathname: string; search: string } } }).window = {
      location: { pathname: "/", search: "" },
    };
    globalWithRuntimeConfig.__AGENT_WEBCLIENT_RUNTIME_CONFIG__ = {
      DESKTOP_APP: false,
    };

    await expect(requestDesktopCurrentResourceAction("reveal", resource)).rejects.toThrow(
      "unavailable",
    );
  });

  it.each([
    ["MacIntel", "finder"],
    ["darwin arm64", "finder"],
    ["Win32", "explorer"],
    ["Linux x86_64", "file-manager"],
  ] as const)("maps %s to %s", (platform, expected) => {
    expect(detectDesktopFileManager(platform)).toBe(expected);
  });

  it("resolves only chat-scoped Artifact and Reference identities", () => {
    expect(resolveDesktopCurrentResourceIdentity(
      "chat-72",
      "artifacts/run-1/%E6%98%9F%E4%BA%91.docx",
    )).toEqual({
      chatId: "chat-72",
      profile: "artifact",
      relativePath: "artifacts/run-1/星云.docx",
    });
    expect(resolveDesktopCurrentResourceIdentity(
      "chat-72",
      "references/source.docx",
    )).toEqual({
      chatId: "chat-72",
      profile: "reference",
      relativePath: "references/source.docx",
    });
    for (const source of [
      "/etc/hosts",
      "artifacts/../report.docx",
      "artifacts/%252e%252e/report.docx",
      "artifacts\\run-1\\report.docx",
      "uploads/report.docx",
      "https://example.com/report.docx",
    ]) {
      expect(resolveDesktopCurrentResourceIdentity("chat-72", source)).toBeNull();
    }
  });

  it("resolves the real DOCX resource from chat 900734df-e540-468b-ab83-b0354fee92d0", () => {
    expect(resolveDesktopCurrentResourceIdentity(
      "900734df-e540-468b-ab83-b0354fee92d0",
      "artifacts/mtb2opxh/%E6%98%9F%E4%BA%91%E5%AE%A2%E6%88%B7%E9%97%A8%E6%88%B7%E5%8D%87%E7%BA%A7%E9%A1%B9%E7%9B%AE%E7%AB%8B%E9%A1%B9%E5%BB%BA%E8%AE%AE%E4%B9%A6.docx",
    )).toEqual({
      chatId: "900734df-e540-468b-ab83-b0354fee92d0",
      profile: "artifact",
      relativePath: "artifacts/mtb2opxh/星云客户门户升级项目立项建议书.docx",
    });
  });
});
