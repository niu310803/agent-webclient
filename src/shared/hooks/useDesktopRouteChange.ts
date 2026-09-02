import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type DesktopRouteChangedPayload = {
  type?: unknown;
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
  routeRevision?: unknown;
};

type DesktopRouteCommand = {
  target: string;
  routeRevision: number | null;
};

type DesktopRouteSubscriber = (
  target: string,
  command: DesktopRouteCommand,
) => void;

type DesktopRouteBridge = {
  listeners: Set<DesktopRouteSubscriber>;
  listening: boolean;
  unsubscribeFromMain: (() => void) | null;
};

type DesktopRouteElectronAPI = {
  onFromMain?: (
    channel: string,
    callback: (event: unknown, payload: DesktopRouteChangedPayload) => void,
  ) => unknown;
};

type DesktopRouteWindow = Window & typeof globalThis & {
  electronAPI?: DesktopRouteElectronAPI;
  [DESKTOP_ROUTE_BRIDGE_KEY]?: DesktopRouteBridge;
};

const DESKTOP_ROUTE_CHANGED_MESSAGE_TYPE = "desktopRouteChanged";
const DESKTOP_ROUTE_APPLIED_MESSAGE_TYPE = "desktopRouteApplied";
export const SERVICE_WEBVIEW_BRIDGE_ROUTE_CHANNEL =
  "desktop:service-webview:route";
export const PAGE_TO_PRELOAD_ROUTE_ACK_EVENT =
  "__desktopServiceWebviewRouteApplied";
const DESKTOP_ROUTE_BRIDGE_KEY = "__AGENT_WEBCLIENT_DESKTOP_ROUTE_BRIDGE__";

let fallbackBridge: DesktopRouteBridge | null = null;

function normalizeRoutePart(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRouteRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

function reportDesktopRouteDiagnostic(
  stage: string,
  details: Record<string, unknown>,
): void {
  console.info("[desktop-route]", stage, details);
}

function acknowledgeDesktopRoute(command: DesktopRouteCommand): void {
  if (command.routeRevision === null || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(PAGE_TO_PRELOAD_ROUTE_ACK_EVENT, {
    detail: {
      type: DESKTOP_ROUTE_APPLIED_MESSAGE_TYPE,
      routeRevision: command.routeRevision,
      routerLocation: command.target,
    },
  }));
  reportDesktopRouteDiagnostic("router-ack", {
    routeRevision: command.routeRevision,
    routerLocation: command.target,
    physicalLocation: `${window.location.pathname}${window.location.search}${window.location.hash}`,
  });
}

export function buildDesktopRouteTarget(
  payload: DesktopRouteChangedPayload,
): string | null {
  const rawPathname = normalizeRoutePart(payload.pathname);
  if (!rawPathname) {
    return null;
  }

  let pathnameWithoutQuery = rawPathname;
  let queryFromPath = "";
  let hashFromPath = "";
  const hashIndex = pathnameWithoutQuery.indexOf("#");
  if (hashIndex >= 0) {
    hashFromPath = pathnameWithoutQuery.slice(hashIndex + 1);
    pathnameWithoutQuery = pathnameWithoutQuery.slice(0, hashIndex);
  }
  const queryIndex = pathnameWithoutQuery.indexOf("?");
  if (queryIndex >= 0) {
    queryFromPath = pathnameWithoutQuery.slice(queryIndex + 1);
    pathnameWithoutQuery = pathnameWithoutQuery.slice(0, queryIndex);
  }

  const pathname = pathnameWithoutQuery.startsWith("/")
    ? pathnameWithoutQuery || "/"
    : `/${pathnameWithoutQuery}`;
  const rawSearch = normalizeRoutePart(payload.search) || queryFromPath;
  const rawHash = normalizeRoutePart(payload.hash) || hashFromPath;
  const search = rawSearch
    ? rawSearch.startsWith("?")
      ? rawSearch
      : `?${rawSearch}`
    : "";
  const hash = rawHash
    ? rawHash.startsWith("#")
      ? rawHash
      : `#${rawHash}`
    : "";

  return `${pathname}${search}${hash}`;
}

export function buildRouterLocationTarget(location: {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
}): string {
  const pathname = normalizeRoutePart(location.pathname) || "/";
  const search = normalizeRoutePart(location.search);
  const hash = normalizeRoutePart(location.hash);
  return `${pathname}${search}${hash}`;
}

function createDesktopRouteBridge(): DesktopRouteBridge {
  return {
    listeners: new Set<DesktopRouteSubscriber>(),
    listening: false,
    unsubscribeFromMain: null,
  };
}

function getDesktopRouteWindow(): DesktopRouteWindow | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window as DesktopRouteWindow;
}

function getDesktopRouteBridge(): DesktopRouteBridge {
  const desktopWindow = getDesktopRouteWindow();
  if (!desktopWindow) {
    fallbackBridge ??= createDesktopRouteBridge();
    return fallbackBridge;
  }

  desktopWindow[DESKTOP_ROUTE_BRIDGE_KEY] ??= createDesktopRouteBridge();
  return desktopWindow[DESKTOP_ROUTE_BRIDGE_KEY];
}

function dispatchDesktopRoutePayload(payload: DesktopRouteChangedPayload): void {
  if (payload.type !== DESKTOP_ROUTE_CHANGED_MESSAGE_TYPE) {
    return;
  }
  const target = buildDesktopRouteTarget(payload);
  if (!target) {
    return;
  }

  const command: DesktopRouteCommand = {
    target,
    routeRevision: readRouteRevision(payload.routeRevision),
  };
  reportDesktopRouteDiagnostic("bridge-received", {
    routeRevision: command.routeRevision,
    target,
    physicalLocation: typeof window === "undefined"
      ? ""
      : `${window.location.pathname}${window.location.search}${window.location.hash}`,
  });

  for (const listener of Array.from(getDesktopRouteBridge().listeners)) {
    listener(target, command);
  }
}

function ensureDesktopRouteBridgeListening(): void {
  const bridge = getDesktopRouteBridge();
  if (bridge.listening) {
    return;
  }

  const electronAPI = getDesktopRouteWindow()?.electronAPI;
  if (typeof electronAPI?.onFromMain !== "function") {
    return;
  }

  const maybeUnsubscribe = electronAPI.onFromMain(
    SERVICE_WEBVIEW_BRIDGE_ROUTE_CHANNEL,
    (_event, payload) => {
      dispatchDesktopRoutePayload(payload);
    },
  );
  bridge.listening = true;
  bridge.unsubscribeFromMain =
    typeof maybeUnsubscribe === "function"
      ? () => {
          (maybeUnsubscribe as () => void)();
        }
      : null;
}

export function subscribeDesktopRouteChanges(
  listener: DesktopRouteSubscriber,
): () => void {
  const bridge = getDesktopRouteBridge();
  bridge.listeners.add(listener);
  ensureDesktopRouteBridgeListening();

  return () => {
    bridge.listeners.delete(listener);
  };
}

export function resetDesktopRouteChangeBridgeForTests(): void {
  const bridge = getDesktopRouteBridge();
  bridge.listeners.clear();
  bridge.listening = false;
  bridge.unsubscribeFromMain?.();
  bridge.unsubscribeFromMain = null;

  const desktopWindow = getDesktopRouteWindow();
  if (desktopWindow) {
    delete desktopWindow[DESKTOP_ROUTE_BRIDGE_KEY];
  }
  fallbackBridge = null;
}

export const useDesktopRouteChange = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routerTargetRef = useRef(buildRouterLocationTarget(location));
  const pendingCommandRef = useRef<DesktopRouteCommand | null>(null);
  routerTargetRef.current = buildRouterLocationTarget(location);

  useEffect(() => {
    return subscribeDesktopRouteChanges((target, command) => {
      // Desktop may already have updated the physical guest URL while React
      // Router still owns the previous route. Only Router location is a valid
      // dedupe signal for this bridge.
      pendingCommandRef.current = command.routeRevision === null ? null : command;
      if (routerTargetRef.current === target) {
        acknowledgeDesktopRoute(command);
        pendingCommandRef.current = null;
        return;
      }
      reportDesktopRouteDiagnostic("router-navigate", {
        routeRevision: command.routeRevision,
        from: routerTargetRef.current,
        target,
        physicalLocation: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      });
      navigate(target, { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    const pending = pendingCommandRef.current;
    if (!pending || routerTargetRef.current !== pending.target) {
      return;
    }
    acknowledgeDesktopRoute(pending);
    pendingCommandRef.current = null;
  }, [location.hash, location.pathname, location.search]);
};
