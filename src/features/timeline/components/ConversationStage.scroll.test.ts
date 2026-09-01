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
  resolveMainChatRuntime: () => ({ running: false }),
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

  beforeEach(() => {
    clearConversationScrollBookmarks();
    mockDispatch.mockReset();
    mockScrollToIndex.mockReset();
    mockScrollBy.mockReset();
    mockVirtuosoProps = null;
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
  });

  afterEach(() => {
    act(() => root.unmount());
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
