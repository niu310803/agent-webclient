/** @jest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInitialState } from "@/app/state/state";
import type { AppState, ChatTransition, TimelineNode } from "@/app/state/types";
import {
  clearConversationScrollBookmarks,
  setConversationScrollBookmark,
} from "@/features/timeline/lib/conversationScrollBookmark";
import { ConversationStage } from "@/features/timeline/components/ConversationStage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mockState: AppState;
let mockStateRef: { current: AppState };
let mockAppContext: any;
let mockVirtuosoProps: any;
let mockMainChatRuntime: any;
const mockDispatch = jest.fn();
const mockScrollToIndex = jest.fn();
const mockScrollBy = jest.fn();

jest.mock("@/app/state/AppContext", () => ({
  useAppState: () => mockState,
  useAppDispatch: () => mockDispatch,
  useOptionalAppContext: () => mockAppContext,
}));

jest.mock("@/features/workers/lib/currentWorker", () => ({
  resolveCurrentWorkerSummary: () => null,
}));

jest.mock("@/features/runs/lib/runRuntimeState", () => ({
  resolveMainChatRuntime: () => mockMainChatRuntime,
  isMainChatRuntimeObservedByLiveQuery: (runtime: any, targetChatId: string) => {
    const session = runtime?.session;
    return Boolean(
      (!runtime?.chatId || runtime.chatId === targetChatId) &&
        session?.streaming &&
        session.observationSource !== "attach" &&
        session.chatId === targetChatId,
    );
  },
}));

jest.mock("@/features/timeline/components/TimelineRow", () => ({
  TimelineRow: (props: { node?: { id?: string; text?: string } }) =>
    React.createElement(
      "div",
      { "data-testid": "timeline-row", "data-node-id": props.node?.id },
      props.node?.text,
    ),
  formatTimelineTime: () => ({ short: "", full: "" }),
}));

jest.mock("@/features/timeline/components/RunTerminalNotice", () => ({
  RunTerminalNotice: () => null,
}));

jest.mock("@/shared/icons/agent", () => ({
  AgentIcon: () => React.createElement("span"),
}));

jest.mock("@/shared/ui/MaterialIcon", () => ({
  MaterialIcon: (props: { name?: string }) =>
    React.createElement("span", { "data-icon": props.name }),
}));

jest.mock("@/shared/ui/UiButton", () => ({
  UiButton: ({ children, ...props }: any) =>
    React.createElement("button", props, children),
}));

jest.mock("@/shared/components/logo-loading", () => ({
  LogoLoading: () => React.createElement("span"),
}));

jest.mock("@/shared/components/dot-loading", () => ({
  DotLoading: () => React.createElement("span"),
}));

jest.mock("@/shared/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

jest.mock("@/shared/data", () => ({
  deriveChat: jest.fn(),
  submitFeedback: jest.fn(),
}));

jest.mock("antd", () => {
  const React = require("react");
  const passthrough = ({ children, ...props }: any) =>
    React.createElement("div", props, children);
  const Form = Object.assign(passthrough, { Item: passthrough });
  const Input = Object.assign(
    (props: any) => React.createElement("input", props),
    { TextArea: (props: any) => React.createElement("textarea", props) },
  );
  return {
    Button: ({ children, ...props }: any) =>
      React.createElement("button", props, children),
    Collapse: passthrough,
    Dropdown: passthrough,
    Flex: passthrough,
    Form,
    Input,
    Popover: passthrough,
    Tooltip: passthrough,
    message: { error: jest.fn(), success: jest.fn() },
  };
});

jest.mock("react-virtuoso", () => {
  const React = require("react");
  const Virtuoso = React.forwardRef((props: any, ref: any) => {
    mockVirtuosoProps = props;
    const scrollerRef = React.useRef(null);
    React.useImperativeHandle(ref, () => ({
      getState: (callback: (snapshot: unknown) => void) =>
        callback({ ranges: [], scrollTop: 0 }),
      scrollBy: mockScrollBy,
      scrollToIndex: mockScrollToIndex,
    }));
    React.useLayoutEffect(() => {
      props.scrollerRef?.(scrollerRef.current);
      return () => props.scrollerRef?.(null);
    }, [props.scrollerRef]);
    const Item = props.components?.Item || "div";
    return React.createElement(
      "div",
      { ref: scrollerRef, className: props.className, id: props.id },
      ...(props.data || []).map((item: unknown, index: number) =>
        React.createElement(
          Item,
          {
            key: props.computeItemKey?.(index, item) ?? index,
            item,
            "data-index": index,
            "data-item-index": index,
            "data-known-size": 0,
            style: {},
          },
          props.itemContent(index, item),
        ),
      ),
    );
  });
  return { Virtuoso };
});

function createTransition(
  phase: ChatTransition["phase"],
  overrides: Partial<ChatTransition> = {},
): ChatTransition {
  return {
    seq: 1,
    sourceChatId: "chat-source",
    targetChatId: "chat-target",
    phase,
    kind: "history-switch",
    displayMode: "blocking",
    focusComposerOnReady: false,
    error: "",
    ...overrides,
  };
}

function createChatState(
  transition: ChatTransition | null = null,
): AppState {
  const node: TimelineNode = {
    id: "query-1",
    kind: "message",
    role: "user",
    text: "hello",
    ts: 1,
  };
  return {
    ...createInitialState(),
    chatId: "chat-target",
    timelineNodes: new Map([[node.id, node]]),
    timelineOrder: [node.id],
    chatLoadSeq: transition?.seq || 0,
    chatTransition: transition,
  };
}

describe("ConversationStage scroll restoration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rafId = 0;
  let reducedMotion = false;

  beforeEach(() => {
    jest.useFakeTimers();
    clearConversationScrollBookmarks();
    mockDispatch.mockReset();
    mockScrollToIndex.mockReset();
    mockScrollBy.mockReset();
    mockVirtuosoProps = null;
    mockMainChatRuntime = {
      chatId: "chat-target",
      session: null,
      running: false,
    };
    mockState = createChatState();
    mockStateRef = { current: mockState };
    mockAppContext = {
      stateRef: mockStateRef,
      querySessionsRef: { current: new Map() },
      chatQuerySessionIndexRef: { current: new Map() },
      activeQuerySessionRequestIdRef: { current: "" },
      conversationViewportRef: { current: null },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const id = ++rafId;
        callback(0);
        return id;
      },
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      value: jest.fn(),
    });
    reducedMotion = false;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: jest.fn(() => ({
        matches: reducedMotion,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    container.remove();
  });

  function renderStage(expectedChatId = "chat-target") {
    act(() => {
      root.render(
        React.createElement(ConversationStage, {
          surfaceMode: "main",
          expectedChatId,
        }),
      );
    });
  }

  it("immediately overlays source content when the route targets another chat", () => {
    renderStage("chat-next");

    expect(container.querySelector(".conversation-transition-overlay")).not.toBeNull();
    expect(container.querySelector('[data-node-id="query-1"]')).not.toBeNull();
    expect(mockVirtuosoProps.followOutput(true)).toBe(false);
  });

  it("keeps a fast blocking history skeleton for 320ms and fades it for 180ms", () => {
    mockState = createChatState(createTransition("loading"));
    mockStateRef.current = mockState;
    renderStage();

    let overlay = container.querySelector<HTMLElement>(
      ".conversation-transition-overlay",
    );
    expect(overlay?.dataset.transitionPhase).toBe("visible");
    expect(overlay?.getAttribute("aria-busy")).toBe("true");

    mockState = createChatState(createTransition("ready"));
    mockStateRef.current = mockState;
    renderStage();
    overlay = container.querySelector<HTMLElement>(
      ".conversation-transition-overlay",
    );
    expect(overlay?.getAttribute("aria-busy")).toBe("false");

    act(() => jest.advanceTimersByTime(319));
    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("visible");

    act(() => jest.advanceTimersByTime(1));
    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("exiting");

    act(() => jest.advanceTimersByTime(179));
    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).not.toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).toBeNull();
  });

  it("starts the full fade as soon as a slow blocking history load is ready", () => {
    mockState = createChatState(createTransition("loading"));
    mockStateRef.current = mockState;
    renderStage();
    act(() => jest.advanceTimersByTime(700));

    mockState = createChatState(createTransition("ready"));
    mockStateRef.current = mockState;
    renderStage();

    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("exiting");
    act(() => jest.advanceTimersByTime(179));
    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).not.toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).toBeNull();
  });

  it("uses transitionend to remove an exiting history skeleton", () => {
    mockState = createChatState(createTransition("loading"));
    mockStateRef.current = mockState;
    renderStage();
    mockState = createChatState(createTransition("ready"));
    mockStateRef.current = mockState;
    renderStage();
    act(() => jest.advanceTimersByTime(320));

    const overlay = container.querySelector<HTMLElement>(
      ".conversation-transition-overlay",
    );
    expect(overlay?.dataset.transitionPhase).toBe("exiting");
    const transitionEnd = new Event("transitionend", { bubbles: true });
    Object.defineProperty(transitionEnd, "propertyName", { value: "opacity" });
    act(() => overlay?.dispatchEvent(transitionEnd));

    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).toBeNull();
  });

  it("does not let an older history timer hide a newer target", () => {
    mockState = {
      ...createChatState(createTransition("loading", {
        targetChatId: "chat-b",
      })),
      chatId: "chat-source",
    };
    mockStateRef.current = mockState;
    renderStage("chat-b");

    mockState = {
      ...createChatState(createTransition("ready", {
        targetChatId: "chat-b",
      })),
      chatId: "chat-b",
    };
    mockStateRef.current = mockState;
    renderStage("chat-b");
    act(() => jest.advanceTimersByTime(100));

    mockState = {
      ...createChatState(createTransition("loading", {
        seq: 2,
        sourceChatId: "chat-b",
        targetChatId: "chat-c",
      })),
      chatId: "chat-b",
    };
    mockStateRef.current = mockState;
    renderStage("chat-c");
    mockState = {
      ...createChatState(createTransition("ready", {
        seq: 2,
        sourceChatId: "chat-b",
        targetChatId: "chat-c",
      })),
      chatId: "chat-c",
    };
    mockStateRef.current = mockState;
    renderStage("chat-c");

    act(() => jest.advanceTimersByTime(220));
    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("visible");
    act(() => jest.advanceTimersByTime(100));
    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("exiting");
  });

  it("shows errors immediately and restarts the minimum duration on retry", () => {
    mockState = createChatState(createTransition("loading"));
    mockStateRef.current = mockState;
    renderStage();
    act(() => jest.advanceTimersByTime(50));

    mockState = createChatState(createTransition("error", {
      error: "history failed",
    }));
    mockStateRef.current = mockState;
    renderStage();
    const errorOverlay = container.querySelector<HTMLElement>(
      ".conversation-transition-overlay",
    );
    expect(errorOverlay?.getAttribute("role")).toBe("alert");
    expect(errorOverlay?.getAttribute("aria-busy")).toBe("false");
    expect(container.textContent).toContain("history failed");
    act(() => jest.advanceTimersByTime(1_000));
    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).not.toBeNull();

    mockState = createChatState(createTransition("loading", { seq: 2 }));
    mockStateRef.current = mockState;
    renderStage();
    mockState = createChatState(createTransition("ready", { seq: 2 }));
    mockStateRef.current = mockState;
    renderStage();
    act(() => jest.advanceTimersByTime(319));
    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("visible");
    act(() => jest.advanceTimersByTime(1));
    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("exiting");
  });

  it("removes an already visible skeleton immediately for background recovery", () => {
    mockState = createChatState(createTransition("loading"));
    mockStateRef.current = mockState;
    renderStage();
    act(() => jest.advanceTimersByTime(100));

    mockState = createChatState(createTransition("restoring", {
      displayMode: "background",
    }));
    mockStateRef.current = mockState;
    renderStage();

    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).toBeNull();
  });

  it("keeps reduced-motion skeletons opaque for the full 500ms", () => {
    reducedMotion = true;
    mockState = createChatState(createTransition("loading"));
    mockStateRef.current = mockState;
    renderStage();
    mockState = createChatState(createTransition("ready"));
    mockStateRef.current = mockState;
    renderStage();

    act(() => jest.advanceTimersByTime(499));
    expect(
      container.querySelector<HTMLElement>(".conversation-transition-overlay")
        ?.dataset.transitionPhase,
    ).toBe("visible");
    act(() => jest.advanceTimersByTime(1));
    expect(
      container.querySelector(".conversation-transition-overlay"),
    ).toBeNull();
  });

  it("keeps the live timeline visible while its canonical route binding catches up", () => {
    mockState = {
      ...createChatState(createTransition("loading", {
        sourceChatId: "chat-source",
        targetChatId: "chat-next",
      })),
      chatId: "chat-source",
    };
    mockStateRef.current = mockState;
    mockMainChatRuntime = {
      chatId: "chat-next",
      session: {
        requestId: "req-live",
        chatId: "chat-next",
        streaming: true,
        observationSource: "query",
      },
      running: true,
    };

    renderStage("chat-next");

    expect(container.querySelector(".conversation-transition-overlay")).toBeNull();
    expect(container.querySelector('[data-node-id="query-1"]')).not.toBeNull();
    expect(mockVirtuosoProps.followOutput(true)).toBe("smooth");
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "CLEAR_CHAT_TRANSITION",
    });
  });

  it("keeps the history overlay until an attached active run is hydrated", () => {
    mockState = {
      ...createChatState(createTransition("loading", {
        sourceChatId: "chat-source",
        targetChatId: "chat-next",
      })),
      chatId: "chat-source",
    };
    mockStateRef.current = mockState;
    mockMainChatRuntime = {
      chatId: "chat-next",
      session: {
        requestId: "req-attach",
        chatId: "chat-next",
        streaming: true,
        observationSource: "attach",
      },
      running: true,
    };

    renderStage("chat-next");

    expect(container.querySelector(".conversation-transition-overlay")).not.toBeNull();
    expect(mockDispatch).not.toHaveBeenCalledWith({
      type: "CLEAR_CHAT_TRANSITION",
    });
  });

  it("shows the replayed timeline while an attached active run restores in the background", () => {
    mockState = {
      ...createChatState(createTransition("loading", {
        sourceChatId: "chat-source",
        targetChatId: "chat-next",
        displayMode: "background",
      })),
      chatId: "chat-next",
      currentChatActiveRun: {
        chatId: "chat-next",
        runId: "run-attach",
      },
    };
    mockStateRef.current = mockState;
    mockMainChatRuntime = {
      chatId: "chat-next",
      session: {
        requestId: "req-attach",
        chatId: "chat-next",
        runId: "run-attach",
        streaming: true,
        observationSource: "attach",
      },
      running: true,
    };

    renderStage("chat-next");

    expect(container.querySelector(".conversation-transition-overlay")).toBeNull();
    expect(container.querySelector('[data-node-id="query-1"]')).not.toBeNull();
    expect(mockVirtuosoProps.followOutput(true)).toBe("smooth");
  });

  it("does not flash the skeleton when the active run completes during restoration", () => {
    mockState = createChatState(createTransition("restoring", {
      displayMode: "background",
    }));
    mockState.currentChatActiveRun = null;
    mockStateRef.current = mockState;

    renderStage();

    expect(container.querySelector(".conversation-transition-overlay")).toBeNull();
    expect(container.querySelector('[data-node-id="query-1"]')).not.toBeNull();
  });

  it("still shows a transition error after an active run was moved to the background", () => {
    mockState = createChatState(createTransition("error", {
      displayMode: "background",
      error: "history failed",
    }));
    mockStateRef.current = mockState;

    renderStage();

    expect(container.querySelector(".conversation-transition-overlay")).not.toBeNull();
    expect(container.textContent).toContain("history failed");
  });

  it("restores a middle anchor with auto scrolling and only then marks ready", () => {
    const transition = createTransition("restoring", {
      focusComposerOnReady: true,
    });
    mockState = createChatState(transition);
    mockStateRef.current = mockState;
    setConversationScrollBookmark(
      { surfaceMode: "main", chatId: "chat-target" },
      {
        anchorItemKey: "query_query-1",
        anchorIndex: 0,
        previousItemKey: null,
        nextItemKey: null,
        anchorOffset: 0,
        atBottom: false,
        dataSignature: "stale-data",
        layoutSignature: "stale-layout",
        savedAt: Date.now(),
      },
    );
    const focusListener = jest.fn();
    window.addEventListener("agent:focus-composer", focusListener);

    renderStage();

    expect(mockScrollToIndex).toHaveBeenCalledWith({
      index: 0,
      behavior: "auto",
      align: "start",
    });
    expect(mockScrollToIndex).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "ADVANCE_CHAT_TRANSITION",
      seq: 1,
      targetChatId: "chat-target",
      phase: "ready",
    });
    expect(focusListener).toHaveBeenCalledTimes(1);
    window.removeEventListener("agent:focus-composer", focusListener);
  });

  it("restores a bottom bookmark instantly and stops following after manual upward scroll", () => {
    const transition = createTransition("restoring");
    mockState = createChatState(transition);
    mockStateRef.current = mockState;
    setConversationScrollBookmark(
      { surfaceMode: "main", chatId: "chat-target" },
      {
        anchorItemKey: "query_query-1",
        anchorIndex: 0,
        previousItemKey: null,
        nextItemKey: null,
        anchorOffset: 0,
        atBottom: true,
        dataSignature: "stale-data",
        layoutSignature: "stale-layout",
        savedAt: Date.now(),
      },
    );

    renderStage();

    expect(mockScrollToIndex).toHaveBeenCalledWith({
      index: "LAST",
      behavior: "auto",
      align: "end",
    });

    mockState = createChatState(null);
    mockStateRef.current = mockState;
    renderStage();
    expect(mockVirtuosoProps.followOutput(true)).toBe("smooth");

    act(() => mockVirtuosoProps.atBottomStateChange(false));
    expect(mockVirtuosoProps.followOutput(true)).toBe(false);
  });
});
