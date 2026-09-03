import React, { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { BtwTabView } from "@/features/btw/components/BtwTab";
import { useStandaloneBtwRuntime } from "@/features/btw/hooks/useStandaloneBtwRuntime";
import { useChatSurfaceReplay } from "@/features/surfaces/useChatSurfaceReplay";
import { useI18n } from "@/shared/i18n";
import { copyText } from "@/shared/utils/copy";
import { MaterialIcon } from "@/shared/ui/MaterialIcon";
import { UiButton } from "@/shared/ui/UiButton";
import { IndependentSurfaceFrame } from "./SurfaceFrame";

export const SelectionExplainPage: React.FC = () => {
  const { chatId: routeChatId } = useParams<{ chatId: string }>();
  const [searchParams] = useSearchParams();
  const chatId = String(routeChatId || "").trim();
  const runId = String(searchParams.get("runId") || "").trim();
  const { t } = useI18n();
  const chatRuntime = useChatSurfaceReplay({ chatId });
  const runtime = useStandaloneBtwRuntime({
    chatId,
    initialRunId: runId,
    owner: chatRuntime.snapshot?.owner || null,
  });
  const latestAnswer = useMemo(() => {
    for (let index = runtime.session.projection.timelineOrder.length - 1; index >= 0; index -= 1) {
      const node = runtime.session.projection.timelineNodes.get(
        runtime.session.projection.timelineOrder[index],
      );
      if (node?.kind === "content" && String(node.text || "").trim()) {
        return String(node.text || "");
      }
    }
    return "";
  }, [runtime.session.projection]);
  const invalid = !chatId || !runId;
  const missingOwner = chatRuntime.status === "ready" && !chatRuntime.snapshot?.owner;

  return (
    <IndependentSurfaceFrame
      kind="selection-explain"
      flushContent
      loading={!invalid && chatRuntime.status === "loading"}
      error={invalid || missingOwner
        ? t("platformError.code.invalid_request")
        : chatRuntime.error}
    >
      <section className="selection-explain-page">
        <header className="selection-explain-header">
          <strong>{t("selection.explain.title")}</strong>
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            disabled={!latestAnswer}
            aria-label={t("selection.explain.copy")}
            title={t("selection.explain.copy")}
            onClick={() => void copyText(latestAnswer)}
          >
            <MaterialIcon name="content_copy" />
          </UiButton>
        </header>
        <BtwTabView
          parentChatId={chatId}
          session={runtime.session}
          onSend={runtime.send}
          onDraftChange={runtime.setDraft}
          onRemoveDraftSelection={() => undefined}
          onInterrupt={runtime.interrupt}
          onNewBranch={runtime.newBranch}
          onPatchTimelineNode={runtime.patchTimelineNode}
        />
      </section>
    </IndependentSurfaceFrame>
  );
};
