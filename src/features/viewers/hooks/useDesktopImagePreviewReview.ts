import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  AGENT_WEBCLIENT_WORKPANEL_PREVIEW_REVIEW_PAGE_EVENT,
  AGENT_WEBCLIENT_WORKPANEL_PREVIEW_REVIEW_VERSION,
  type AgentWebclientWorkPanelPreviewReviewAction,
} from "@/features/transport/contracts/generated/agentWebclientBridge";
import { useDesktopCurrentPreviewReview } from "@/shared/data/desktop/desktopContextMenu";

const REVIEW_COLOR = "#ff4d4f";
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_SIDE = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;

type ReviewRect = { x: number; y: number; width: number; height: number };
type ImageReviewAnnotation = {
  id: string;
  number: number;
  kind: "image-region";
  rect: ReviewRect;
  normalizedRect: ReviewRect;
  requirement: string;
};
type Runtime = {
  enabled: boolean;
  annotations: ImageReviewAnnotation[];
  overlay: HTMLDivElement | null;
  draft: HTMLDivElement | null;
};

function emitReviewEvent(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(AGENT_WEBCLIENT_WORKPANEL_PREVIEW_REVIEW_PAGE_EVENT, {
    detail: { version: AGENT_WEBCLIENT_WORKPANEL_PREVIEW_REVIEW_VERSION, ...detail },
  }));
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function bounded(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : null;
}

function readRect(value: unknown, normalized = false): ReviewRect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const max = normalized ? 1 : Number.MAX_SAFE_INTEGER;
  const x = bounded(record.x, 0, max);
  const y = bounded(record.y, 0, max);
  const width = bounded(record.width, 0, max);
  const height = bounded(record.height, 0, max);
  return x === null || y === null || width === null || height === null
    ? null
    : { x, y, width, height };
}

function readAnnotations(value: unknown): ImageReviewAnnotation[] {
  if (!Array.isArray(value) || value.length > 50) return [];
  return value.flatMap((candidate): ImageReviewAnnotation[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const rect = readRect(record.rect);
    const normalizedRect = readRect(record.normalizedRect, true);
    const id = typeof record.id === "string" ? record.id.slice(0, 256) : "";
    const number = Number.isSafeInteger(record.number) && Number(record.number) > 0
      ? Number(record.number)
      : 0;
    if (record.kind !== "image-region" || !id || !number || !rect || !normalizedRect) return [];
    return [{
      id,
      number,
      kind: "image-region",
      rect,
      normalizedRect,
      requirement: typeof record.requirement === "string"
        ? record.requirement.slice(0, 1_000)
        : "",
    }];
  });
}

function findDesktopReviewImageElement(
  host: HTMLElement | null,
  requireLoaded = true,
) {
  const image = host?.querySelector("img");
  if (!(image instanceof HTMLImageElement)) return null;
  return !requireLoaded || image.naturalWidth > 0 ? image : null;
}

function imageElement(host: HTMLElement | null) {
  return findDesktopReviewImageElement(host, true);
}

function render(runtime: Runtime, host: HTMLElement | null) {
  const overlay = runtime.overlay;
  const image = imageElement(host);
  if (!overlay || !image) return;
  const rect = image.getBoundingClientRect();
  Object.assign(overlay.style, {
    display: rect.width > 0 && rect.height > 0 ? "block" : "none",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: runtime.enabled ? "auto" : "none",
    cursor: runtime.enabled ? "crosshair" : "default",
  });
  overlay.replaceChildren();
  for (const annotation of runtime.annotations) {
    const box = document.createElement("div");
    const normalized = annotation.normalizedRect;
    Object.assign(box.style, {
      position: "absolute",
      left: `${normalized.x * 100}%`,
      top: `${normalized.y * 100}%`,
      width: `${normalized.width * 100}%`,
      height: `${normalized.height * 100}%`,
      boxSizing: "border-box",
      border: `2px solid ${REVIEW_COLOR}`,
      background: "rgba(255,77,79,.05)",
      pointerEvents: "none",
    });
    const label = document.createElement("span");
    label.textContent = String(annotation.number);
    Object.assign(label.style, {
      position: "absolute",
      left: "-12px",
      top: "-12px",
      display: "grid",
      placeItems: "center",
      width: "24px",
      height: "24px",
      borderRadius: "999px",
      color: "#fff",
      background: REVIEW_COLOR,
      font: "700 12px/1 sans-serif",
      boxShadow: "0 2px 8px rgba(0,0,0,.24)",
    });
    box.appendChild(label);
    overlay.appendChild(box);
  }
}

function exportAnnotatedImage(
  action: AgentWebclientWorkPanelPreviewReviewAction,
  runtime: Runtime,
  host: HTMLElement | null,
) {
  const image = imageElement(host);
  if (
    !image ||
    image.naturalWidth > MAX_IMAGE_SIDE ||
    image.naturalHeight > MAX_IMAGE_SIDE ||
    image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS
  ) {
    emitReviewEvent({
      event: "image-exported",
      requestId: action.requestId,
      ok: false,
      code: "image_unavailable",
      message: "image unavailable",
    });
    return;
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.drawImage(image, 0, 0);
    const scale = Math.max(1, Math.min(canvas.width, canvas.height) / 900);
    context.lineWidth = Math.max(3, Math.round(4 * scale));
    context.strokeStyle = REVIEW_COLOR;
    context.fillStyle = REVIEW_COLOR;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `700 ${Math.max(18, Math.round(22 * scale))}px sans-serif`;
    for (const annotation of runtime.annotations) {
      const { x, y, width, height } = annotation.rect;
      context.strokeRect(x, y, width, height);
      const radius = Math.max(14, Math.round(16 * scale));
      context.beginPath();
      context.arc(Math.max(radius, x), Math.max(radius, y), radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff";
      context.fillText(String(annotation.number), Math.max(radius, x), Math.max(radius, y));
      context.fillStyle = REVIEW_COLOR;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const paddingBytes = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const sizeBytes = Math.floor(base64.length * 0.75) - paddingBytes;
    if (sizeBytes <= 0 || sizeBytes > MAX_PNG_BYTES) throw new Error("image export too large");
    emitReviewEvent({
      event: "image-exported",
      requestId: action.requestId,
      ok: true,
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      sizeBytes,
    });
  } catch {
    emitReviewEvent({
      event: "image-exported",
      requestId: action.requestId,
      ok: false,
      code: "image_export_failed",
      message: "image export failed",
    });
  }
}

export function useDesktopImagePreviewReview(input: {
  enabled: boolean;
  fileName: string;
  sourceKey: string;
  imageHostRef: RefObject<HTMLDivElement>;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const runtimeRef = useRef<Runtime>({
    enabled: false,
    annotations: [],
    overlay: null,
    draft: null,
  });

  const emitCapability = useCallback((requestId: string) => {
    const current = inputRef.current;
    const image = imageElement(current.imageHostRef.current);
    emitReviewEvent({
      event: "capability",
      requestId,
      kind: current.enabled && image ? "image" : null,
      ...(current.enabled && image ? {
        fileName: current.fileName.slice(0, 512),
        revision: stableHash(current.sourceKey),
      } : {}),
    });
    if (current.enabled && image) {
      emitReviewEvent({
        event: "ready",
        kind: "image",
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    }
  }, []);

  const handleAction = useCallback((action: AgentWebclientWorkPanelPreviewReviewAction) => {
    if (
      action.version !== AGENT_WEBCLIENT_WORKPANEL_PREVIEW_REVIEW_VERSION ||
      !action.requestId
    ) return;
    if (action.operation === "capabilities") {
      emitCapability(action.requestId);
      return;
    }
    if (action.kind !== "image") return;
    if (action.operation === "initialize" || action.operation === "sync") {
      runtimeRef.current.enabled = action.enabled === true;
      runtimeRef.current.annotations = readAnnotations(action.annotations);
      render(runtimeRef.current, inputRef.current.imageHostRef.current);
      return;
    }
    if (action.operation === "export-image") {
      runtimeRef.current.annotations = readAnnotations(action.annotations);
      exportAnnotatedImage(action, runtimeRef.current, inputRef.current.imageHostRef.current);
    }
  }, [emitCapability]);

  useDesktopCurrentPreviewReview(input.enabled ? handleAction : null);

  useEffect(() => {
    if (!input.enabled) return;
    const runtime = runtimeRef.current;
    const overlay = document.createElement("div");
    runtime.overlay = overlay;
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      touchAction: "none",
      userSelect: "none",
    });
    document.body.appendChild(overlay);
    let origin: { x: number; y: number } | null = null;

    const updateDraft = (x: number, y: number) => {
      if (!origin) return;
      runtime.draft?.remove();
      const draft = document.createElement("div");
      runtime.draft = draft;
      Object.assign(draft.style, {
        position: "absolute",
        left: `${Math.min(origin.x, x)}px`,
        top: `${Math.min(origin.y, y)}px`,
        width: `${Math.abs(x - origin.x)}px`,
        height: `${Math.abs(y - origin.y)}px`,
        boxSizing: "border-box",
        border: `2px dashed ${REVIEW_COLOR}`,
        background: "rgba(255,77,79,.08)",
        pointerEvents: "none",
      });
      overlay.appendChild(draft);
    };
    overlay.onpointerdown = (event) => {
      if (!runtime.enabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      origin = { x: event.offsetX, y: event.offsetY };
      overlay.setPointerCapture(event.pointerId);
      updateDraft(event.offsetX, event.offsetY);
    };
    overlay.onpointermove = (event) => {
      if (!origin) return;
      event.preventDefault();
      updateDraft(event.offsetX, event.offsetY);
    };
    overlay.onpointerup = (event) => {
      if (!origin) return;
      event.preventDefault();
      event.stopPropagation();
      const image = imageElement(inputRef.current.imageHostRef.current);
      const start = origin;
      origin = null;
      runtime.draft?.remove();
      runtime.draft = null;
      if (!image || overlay.clientWidth <= 0 || overlay.clientHeight <= 0) return;
      const endX = Math.max(0, Math.min(overlay.clientWidth, event.offsetX));
      const endY = Math.max(0, Math.min(overlay.clientHeight, event.offsetY));
      const left = Math.min(start.x, endX);
      const top = Math.min(start.y, endY);
      const width = Math.abs(endX - start.x);
      const height = Math.abs(endY - start.y);
      if (width < 4 || height < 4) return;
      const normalizedRect = {
        x: left / overlay.clientWidth,
        y: top / overlay.clientHeight,
        width: width / overlay.clientWidth,
        height: height / overlay.clientHeight,
      };
      emitReviewEvent({
        event: "image-region-created",
        rect: {
          x: Math.round(normalizedRect.x * image.naturalWidth),
          y: Math.round(normalizedRect.y * image.naturalHeight),
          width: Math.round(normalizedRect.width * image.naturalWidth),
          height: Math.round(normalizedRect.height * image.naturalHeight),
        },
        normalizedRect,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
      });
    };
    const refresh = () => render(runtime, inputRef.current.imageHostRef.current);
    const onLoad = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      refresh();
      emitCapability(`ready-${Date.now()}`);
    };
    const host = input.imageHostRef.current;
    let observedImage: HTMLImageElement | null = null;
    const observeImageLoad = () => {
      const nextImage = findDesktopReviewImageElement(host, false);
      if (nextImage === observedImage) return;
      observedImage?.removeEventListener("load", onLoad);
      observedImage = nextImage;
      observedImage?.addEventListener("load", onLoad);
    };
    const observer = new MutationObserver(() => {
      observeImageLoad();
      refresh();
    });
    if (host) observer.observe(host, { childList: true, subtree: true });
    observeImageLoad();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(refresh);
    if (host) resizeObserver?.observe(host);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    window.requestAnimationFrame(() => {
      refresh();
      emitCapability(`mounted-${Date.now()}`);
    });
    return () => {
      observer.disconnect();
      resizeObserver?.disconnect();
      observedImage?.removeEventListener("load", onLoad);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      overlay.remove();
      runtime.overlay = null;
      runtime.draft = null;
      runtime.enabled = false;
      runtime.annotations = [];
    };
  }, [emitCapability, input.enabled, input.sourceKey]);
}
