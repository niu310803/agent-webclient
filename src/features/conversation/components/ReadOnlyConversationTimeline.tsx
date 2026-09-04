import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import type { Agent, TimelineNode, TimelineSource } from "@/app/state/types";
import type { ChatDetailResponse } from "@/shared/data";
import type { ChatReplayProjection } from "@/features/conversation/lib/chatReplayProjection";
import {
  buildTimelineDisplayItems,
  type TimelineDisplayItem,
} from "@/features/timeline/lib/timelineDisplay";
import {
  TimelineRow,
  formatTimelineTime,
} from "@/features/timeline/components/TimelineRow";
import { TimelineRenderEntryView } from "@/features/timeline/components/TimelineRenderEntryView";
import {
  TimelineInteractionProvider,
  type TimelineInteractionValue,
} from "@/features/timeline/components/TimelineInteractionContext";
import { RunTerminalNotice } from "@/features/timeline/components/RunTerminalNotice";
import { formatResponseDuration } from "@/shared/utils/formatResponseDuration";
import { useOpenTarget } from "@/features/surfaces/openTarget";
import { useI18n } from "@/shared/i18n";
import styles from "./ReadOnlyConversationTimeline.module.css";

export function findHighlightedRunIndex(
  items: TimelineDisplayItem[],
  targetRunId: string,
  activeRunId = "",
): number {
  const normalizedTarget = String(targetRunId || "").trim();
  if (!normalizedTarget) return -1;

  const exactIndex = items.findIndex(
    (item) => item.kind === "run" && item.runId === normalizedTarget,
  );
  if (exactIndex >= 0) return exactIndex;

  if (String(activeRunId || "").trim() !== normalizedTarget) return -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "run" && !item.terminalType) return index;
  }
  return -1;
}

export interface ReadOnlyConversationTimelineProps {
  chat: ChatDetailResponse;
  projection: ChatReplayProjection;
  agents: Agent[];
  targetRunId?: string;
  agentKey?: string;
  teamChat?: boolean;
}

export const ReadOnlyConversationTimeline: React.FC<
  ReadOnlyConversationTimelineProps
> = ({
  chat,
  projection,
  agents,
  targetRunId = "",
  agentKey = "",
  teamChat = false,
}) => {
  const { locale, t } = useI18n();
  const openTarget = useOpenTarget();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [expandedTaskGroups, setExpandedTaskGroups] = useState<
    Record<string, boolean>
  >({});
  const chatId = String(chat.chatId || projection.state.chatId || "").trim();
  const activeRunId = String(chat.activeRun?.runId || "").trim();

  useEffect(() => {
    setExpandedNodeIds(new Map());
    setExpandedTaskGroups({});
  }, [chatId]);

  const timelineEntries = useMemo(
    () =>
      projection.state.timelineOrder
        .map((id) => {
          const node = projection.state.timelineNodes.get(id);
          if (!node || !expandedNodeIds.has(id)) return node;
          return { ...node, expanded: expandedNodeIds.get(id) };
        })
        .filter((node): node is TimelineNode => Boolean(node)),
    [expandedNodeIds, projection],
  );
  const displayItems = useMemo(
    () =>
      buildTimelineDisplayItems(
        timelineEntries,
        projection.state.events,
        projection.state.taskItemsById,
        { hasActiveRun: Boolean(activeRunId) },
      ),
    [activeRunId, projection, timelineEntries],
  );
  const highlightedRunIndex = useMemo(
    () => findHighlightedRunIndex(displayItems, targetRunId, activeRunId),
    [activeRunId, displayItems, targetRunId],
  );

  useEffect(() => {
    if (highlightedRunIndex < 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: highlightedRunIndex,
      align: "center",
      behavior: "auto",
    });
  }, [highlightedRunIndex]);

  const patchNode = useCallback((node: TimelineNode) => {
    setExpandedNodeIds((current) => {
      const next = new Map(current);
      next.set(node.id, Boolean(node.expanded));
      return next;
    });
  }, []);

  const openSource = useCallback(
    (source: TimelineSource, node?: TimelineNode) => {
      const publishId = String(node?.sourcePublishId || "").trim();
      if (!publishId) return;
      openTarget({
        version: 1,
        kind: "source",
        chatId,
        publishId,
        sourceId: source.id,
        source,
        title: source.title || source.name,
      });
    },
    [chatId, openTarget],
  );

  const interaction = useMemo<TimelineInteractionValue>(
    () => ({
      conversationActive: false,
      readOnly: true,
      surfaceContext: {
        chatId,
        agentKey: String(agentKey || "").trim() || undefined,
        teamChat,
      },
      patchNode,
      openSource,
    }),
    [agentKey, chatId, openSource, patchNode, teamChat],
  );

  const toggleTaskGroup = useCallback((key: string) => {
    setExpandedTaskGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  const renderEntry = useCallback(
    (entry: Extract<TimelineDisplayItem, { kind: "run" }>['renderEntries'][number]) => (
      <TimelineRenderEntryView
        key={entry.key}
        entry={entry}
        agents={agents}
        fallbackAgentKey={agentKey}
        expandedTaskGroups={expandedTaskGroups}
        onToggleTaskGroup={toggleTaskGroup}
      />
    ),
    [agentKey, agents, expandedTaskGroups, toggleTaskGroup],
  );

  if (displayItems.length === 0) {
    return (
      <div className={styles.empty} role="status">
        {t("automationHistory.chat.empty")}
      </div>
    );
  }

  return (
    <TimelineInteractionProvider value={interaction}>
      <div
        className={styles.root}
        role="region"
        aria-label={t("automationHistory.panel.chat")}
      >
        <Virtuoso
          ref={virtuosoRef}
          className={styles.virtuoso}
          data={displayItems}
          computeItemKey={(_index, item) => item.key}
          increaseViewportBy={400}
          itemContent={(index, item) => {
            if (item.kind === "query") {
              return (
                <div className={styles.item}>
                  <TimelineRow node={item.node} showTime />
                </div>
              );
            }

            if (item.kind === "run") {
              const highlighted = index === highlightedRunIndex;
              const duration = formatResponseDuration(
                item.responseDurationMs,
                t,
              );
              const time = formatTimelineTime(item.completedAt, locale, {
                today: t("timeline.time.today"),
                yesterday: t("timeline.time.yesterday"),
              });
              const displayedRunId =
                item.runId || (highlighted ? activeRunId : "");
              return (
                <div className={styles.item}>
                  <section
                    className={`${styles.run} ${highlighted ? styles.currentRun : ""}`}
                    data-run-id={displayedRunId || undefined}
                    data-current-execution={highlighted ? "true" : undefined}
                    aria-label={
                      highlighted
                        ? t("automationHistory.chat.currentExecution")
                        : undefined
                    }
                  >
                    {highlighted ? (
                      <span className={styles.currentRunLabel}>
                        {t("automationHistory.chat.currentExecution")}
                      </span>
                    ) : null}
                    <div className={styles.runEntries}>
                      {item.renderEntries.map(renderEntry)}
                    </div>
                    {item.terminalType ? (
                      <RunTerminalNotice
                        terminalType={item.terminalType}
                        duration={duration}
                      />
                    ) : null}
                    {time.short || displayedRunId ? (
                      <div className={styles.runMeta}>
                        {displayedRunId ? <span>{displayedRunId}</span> : null}
                        {time.short ? (
                          <time title={time.full}>
                            {time.short}{duration ? ` · ${duration}` : ""}
                          </time>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                </div>
              );
            }

            return (
              <div className={styles.item}>
                <TimelineRenderEntryView
                  entry={item.renderEntry}
                  agents={agents}
                  fallbackAgentKey={agentKey}
                  expandedTaskGroups={expandedTaskGroups}
                  onToggleTaskGroup={toggleTaskGroup}
                />
              </div>
            );
          }}
        />
      </div>
    </TimelineInteractionProvider>
  );
};
