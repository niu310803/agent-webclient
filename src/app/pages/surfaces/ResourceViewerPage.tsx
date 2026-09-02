import React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ContentViewerPanel } from "@/features/viewers/components/ContentViewerPanel";
import {
  buildResourceViewerTargetFromUrl,
  type ResourceViewerTarget,
} from "@/features/viewers/lib/viewerTarget";
import { classifyResourceUrl } from "@/shared/data";
import { useI18n } from "@/shared/i18n";
import { IndependentSurfaceFrame } from "./SurfaceFrame";

export function buildResourceViewerTargetFromRoute(input: {
  agentKey: string;
  chatId: string;
  file: string;
  sourceKind?: string;
  resourceId?: string;
  relativePath?: string;
}): ResourceViewerTarget | null {
  const agentKey = String(input.agentKey || "").trim();
  const chatId = String(input.chatId || "").trim();
  const file = String(input.file || "").trim();
  const classification = classifyResourceUrl(file, chatId);
  const allowed = classification.kind === "chat" || classification.kind === "absolute";
  if (!agentKey || !chatId || !file || !allowed) return null;
  const target = buildResourceViewerTargetFromUrl(file);
  const sourceKind = input.sourceKind === "artifact" || input.sourceKind === "reference"
    ? input.sourceKind
    : "";
  return target && sourceKind && input.resourceId && input.relativePath
    ? {
        ...target,
        source: {
          kind: sourceKind,
          agentKey,
          chatId,
          resourceId: input.resourceId,
          relativePath: input.relativePath,
        },
      }
    : target;
}

export const ResourceViewerPage: React.FC = () => {
  const { agentKey: routeAgentKey } = useParams<{ agentKey: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();
  const agentKey = String(routeAgentKey || "").trim();
  const chatId = String(searchParams.get("chatId") || "").trim();
  const file = String(searchParams.get("file") || "").trim();
  const sourceKind = String(searchParams.get("sourceKind") || "").trim();
  const resourceId = String(searchParams.get("resourceId") || "").trim();
  const relativePath = String(searchParams.get("relativePath") || "").trim();
  const target = buildResourceViewerTargetFromRoute({
    agentKey, chatId, file, sourceKind, resourceId, relativePath,
  });
  return (
    <IndependentSurfaceFrame
      kind="resource"
      error={target ? "" : t("platformError.code.invalid_request")}
      flushContent={target?.contentKind === "html"}
    >
      {target ? (
        <ContentViewerPanel
          target={target}
          enableDesktopCurrentResourceDownload
          enableDesktopLocalResourceActions
          enableDesktopPreviewReview
          surfaceContext={{ chatId, teamChat: false }}
        />
      ) : null}
    </IndependentSurfaceFrame>
  );
};
