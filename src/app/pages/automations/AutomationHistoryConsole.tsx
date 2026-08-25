import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Drawer, Dropdown, Input, Modal, Spin, Tooltip, message } from "antd";
import type { MenuProps } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import type { Agent, Team } from "@/app/state/types";
import { useAppDispatch, useAppState } from "@/app/state/AppContext";
import {
  AutomationModal,
  buildDuplicateAutomationPayload,
  fetchAutomationAgentsForSelect,
} from "@/app/modals/AutomationModal";
import type { CurrentWorkerSummary } from "@/features/workers/lib/currentWorker";
import {
  ApiError,
  createAutomation,
  deleteAutomation,
  getAutomation,
  getAutomationExecution,
  getAutomationExecutions,
  getAutomations,
  toggleAutomation,
} from "@/shared/data";
import type {
  AutomationExecutionDetailResponse,
  AutomationExecutionHistoryStatus,
  AutomationExecutionResponse,
  AutomationExecutionStatus,
  AutomationSummaryResponse,
} from "@/shared/data";
import { usePushTransport } from "@/features/transport/hooks/useRealtimeTransport";
import { describeCronExpression } from "@/features/automations/lib/cronDescription";
import {
  automationExecutionDateTimeLabel,
  automationExecutionDurationLabel,
  automationExecutionPreview,
  automationExecutionTimeLabel,
  groupAutomationExecutions,
  mergeAutomationExecutionPages,
} from "@/features/automations/lib/executionView";
import { MaterialIcon, type MaterialIconName } from "@/shared/ui/MaterialIcon";
import { AgentIcon } from "@/shared/icons/agent";
import { UiButton } from "@/shared/ui/UiButton";
import { UiTag } from "@/shared/ui/UiTag";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { useI18n } from "@/shared/i18n";
import { copyText } from "@/shared/utils/copy";
import {
  buildSurfaceRoute,
  readSurfacePresentationContext,
} from "@/features/surfaces/surfaceRoutes";
import styles from "./AutomationHistoryConsole.module.css";

const EXECUTION_PAGE_SIZE = 20;
const EXECUTION_PUSH_DEBOUNCE_MS = 160;
const HISTORY_RECHECK_MS = 5_000;

const INITIAL_HISTORY_STATUS: AutomationExecutionHistoryStatus = {
  available: false,
  state: "initializing",
};

const STATUS_ICON: Record<AutomationExecutionStatus, MaterialIconName> = {
  running: "progress_activity",
  success: "check",
  failed: "error",
  canceled: "stop_circle",
};

function readPushPayload(frame: {
  payload?: unknown;
  data?: unknown;
}): Record<string, unknown> {
  const value = frame.payload || frame.data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function automationWorkerLabel(
  item: AutomationSummaryResponse,
  agentByKey: Map<string, Agent>,
  teamById: Map<string, Team>,
): string {
  const teamId = String(item.teamId || "").trim();
  if (teamId) return String(teamById.get(teamId)?.name || "--");
  const agentKey = String(item.agentKey || "").trim();
  return String(agentByKey.get(agentKey)?.name || "--");
}

function AutomationEditorDrawer({
  open,
  automationId,
  currentWorker,
  agents,
  teams,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  automationId: string;
  currentWorker: CurrentWorkerSummary | null;
  agents: Agent[];
  teams: Team[];
  onClose: () => void;
  onSaved: (automationId: string) => void;
  onDeleted: (automationId: string) => void;
}) {
  const { t } = useI18n();
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) setDirty(false);
  }, [open]);

  const close = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    Modal.confirm({
      title: t("automationHistory.editor.discardTitle"),
      content: t("automationHistory.editor.discardContent"),
      okText: t("automationHistory.action.discard"),
      cancelText: t("automationHistory.action.continueEditing"),
      okButtonProps: { danger: true },
      onOk: onClose,
    });
  }, [dirty, onClose, t]);

  return (
    <Drawer
      open={open}
      onClose={close}
      destroyOnHidden
      placement="right"
      width="min(680px, 100vw)"
      className={styles.editorDrawer}
      title={
        automationId
          ? t("automationHistory.editor.editTitle")
          : t("automationHistory.editor.createTitle")
      }
      closable={{ closeIcon: <MaterialIcon name="chevron_right" /> }}
      styles={{
        header: { borderBottom: 0, padding: "10px 12px" },
        body: { padding: "0 12px 12px", overflow: "hidden" },
      }}
    >
      <AutomationModal
        key={automationId || "new"}
        currentWorker={currentWorker}
        agents={agents}
        teams={teams}
        embedded
        editorOnly
        initialAutomationId={automationId}
        onDirtyChange={setDirty}
        onSaved={(id) => {
          setDirty(false);
          onSaved(id);
        }}
        onDeleted={(id) => {
          setDirty(false);
          onDeleted(id);
        }}
      />
    </Drawer>
  );
}

function AutomationResultDrawer({
  execution,
  detail,
  loading,
  error,
  onClose,
  onOpenConversation,
  onRetryDetail,
}: {
  execution: AutomationExecutionResponse | null;
  detail: AutomationExecutionDetailResponse | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onOpenConversation: (item: AutomationExecutionResponse) => void;
  onRetryDetail: () => void;
}) {
  const { locale, t } = useI18n();
  const visible = detail || execution;
  const canOpenConversation = Boolean(
    visible?.chatId && (visible.agentKey || visible.teamId),
  );
  const copy = async (value: string) => {
    await copyText(value);
    message.success(t("automationHistory.message.copied"));
  };

  return (
    <Drawer
      open={Boolean(execution)}
      onClose={onClose}
      destroyOnHidden
      placement="right"
      width="min(680px, 100vw)"
      className={styles.resultDrawer}
      title={t("automationHistory.result.title")}
      closable={{ closeIcon: <MaterialIcon name="chevron_right" /> }}
      styles={{
        header: { borderBottom: 0, padding: "10px 12px" },
        body: { padding: "0 16px 20px" },
      }}
    >
      <Spin spinning={loading}>
        {error ? (
          <div className={styles.drawerError}>
            <MaterialIcon name="error" />
            <span>{error}</span>
            <UiButton size="sm" variant="ghost" onClick={onRetryDetail}>
              <MaterialIcon name="refresh" />
              {t("automationConsole.action.retry")}
            </UiButton>
          </div>
        ) : visible ? (
          <div className={styles.resultDrawerContent}>
            <div className={styles.drawerKicker}>
              <span className={`${styles.status} ${styles[visible.status]}`}>
                <MaterialIcon name={STATUS_ICON[visible.status]} />
                {t(`automationHistory.status.${visible.status}`)}
              </span>
              <span>{automationExecutionDateTimeLabel(visible, locale)}</span>
              <span>·</span>
              <span>{automationExecutionDurationLabel(visible.durationMs)}</span>
            </div>

            <div className={styles.drawerActions}>
              {detail?.resultContent ? (
                <UiButton
                  size="sm"
                  variant="ghost"
                  onClick={() => void copy(detail.resultContent)}
                >
                  <MaterialIcon name="content_copy" />
                  {t("automationHistory.action.copyResult")}
                </UiButton>
              ) : null}
              {canOpenConversation ? (
                <UiButton
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenConversation(visible)}
                >
                  <MaterialIcon name="open_in_new" />
                  {t("automationHistory.action.openConversation")}
                </UiButton>
              ) : null}
            </div>

            <section className={styles.resultSection}>
              <h3>{t("automationHistory.result.assistantOutput")}</h3>
              {detail?.resultContent ? (
                <div className={styles.markdownResult}>
                  <MarkdownContent
                    content={detail.resultContent}
                    chatId={detail.chatId || ""}
                    teamChat={Boolean(detail.teamId)}
                  />
                </div>
              ) : (
                <div className={styles.resultEmpty}>
                  {t("automationHistory.result.empty")}
                </div>
              )}
            </section>

            <dl className={styles.resultMeta}>
              <div>
                <dt>{t("automationHistory.field.executionId")}</dt>
                <dd>
                  <button type="button" onClick={() => void copy(visible.id)}>
                    {visible.id}
                    <MaterialIcon name="content_copy" />
                  </button>
                </dd>
              </div>
              {visible.runId ? (
                <div>
                  <dt>{t("automationHistory.field.runId")}</dt>
                  <dd>
                    <button type="button" onClick={() => void copy(visible.runId || "")}>
                      {visible.runId}
                      <MaterialIcon name="content_copy" />
                    </button>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>{t("automationHistory.field.finishReason")}</dt>
                <dd>{visible.finishReason || "--"}</dd>
              </div>
              {visible.error ? (
                <div>
                  <dt>{t("automationHistory.result.error")}</dt>
                  <dd>{visible.error}</dd>
                </div>
              ) : null}
            </dl>

            {detail?.queryContent ? (
              <details className={styles.queryDetails}>
                <summary>{t("automationHistory.result.queryContent")}</summary>
                <pre>{detail.queryContent}</pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </Spin>
    </Drawer>
  );
}

export function AutomationHistoryConsole({
  currentWorker,
  agents,
  teams,
}: {
  currentWorker: CurrentWorkerSummary | null;
  agents: Agent[];
  teams: Team[];
}) {
  const { locale, t } = useI18n();
  const state = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const push = usePushTransport();
  const automations = state.automations;
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [executions, setExecutions] = useState<AutomationExecutionResponse[]>([]);
  const [executionTotal, setExecutionTotal] = useState(0);
  const [expandedId, setExpandedId] = useState("");
  const [historyStatus, setHistoryStatus] = useState(INITIAL_HISTORY_STATUS);
  const [listLoading, setListLoading] = useState(false);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [executionError, setExecutionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorAutomationId, setEditorAutomationId] = useState("");
  const [resultExecution, setResultExecution] =
    useState<AutomationExecutionResponse | null>(null);
  const [resultDetail, setResultDetail] =
    useState<AutomationExecutionDetailResponse | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState("");
  const selectedIdRef = useRef(selectedId);
  const executionsRef = useRef<AutomationExecutionResponse[]>(executions);
  const listRequestRef = useRef(0);
  const executionRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const pushTimerRef = useRef<number | null>(null);

  const effectiveAgents = agents.length ? agents : state.agents;
  const effectiveTeams = teams.length ? teams : state.teams;
  const agentByKey = useMemo(
    () => new Map(effectiveAgents.map((item) => [item.key, item])),
    [effectiveAgents],
  );
  const teamById = useMemo(
    () => new Map(effectiveTeams.map((item) => [item.teamId, item])),
    [effectiveTeams],
  );
  const selected = useMemo(
    () => automations.find((item) => item.id === selectedId) || null,
    [automations, selectedId],
  );
  const filteredAutomations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    if (!query) return automations;
    return automations.filter((item) =>
      [
        item.name,
        item.description,
        item.agentKey,
        item.teamId,
        item.cron,
        automationWorkerLabel(item, agentByKey, teamById),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(query),
    );
  }, [agentByKey, automations, locale, search, teamById]);
  const enabledAutomations = filteredAutomations.filter((item) => item.enabled);
  const disabledAutomations = filteredAutomations.filter((item) => !item.enabled);
  const groupedExecutions = useMemo(
    () =>
      groupAutomationExecutions(executions, {
        locale,
        todayLabel: t("automationHistory.day.today"),
        yesterdayLabel: t("automationHistory.day.yesterday"),
      }),
    [executions, locale, t],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    executionsRef.current = executions;
  }, [executions]);

  const loadExecutions = useCallback(
    async (automationId: string, replace: boolean, silent = false) => {
      const id = String(automationId || "").trim();
      if (!id) return;
      const request = executionRequestRef.current + 1;
      executionRequestRef.current = request;
      if (!silent) {
        if (replace) setExecutionLoading(true);
        else setMoreLoading(true);
      }
      setExecutionError("");
      try {
        const response = await getAutomationExecutions({
          id,
          limit: EXECUTION_PAGE_SIZE,
          offset: replace ? 0 : executionsRef.current.length,
        });
        if (request !== executionRequestRef.current || id !== selectedIdRef.current) return;
        const incoming = response.data.items || [];
        setExecutions((current) => {
          const next = mergeAutomationExecutionPages(current, incoming, replace);
          executionsRef.current = next;
          setExpandedId((currentExpanded) =>
            currentExpanded && next.some((item) => item.id === currentExpanded)
              ? currentExpanded
              : next[0]?.id || "",
          );
          return next;
        });
        setExecutionTotal(response.data.total || 0);
      } catch (error) {
        if (request !== executionRequestRef.current || id !== selectedIdRef.current) return;
        if (error instanceof ApiError && error.status === 503) {
          setHistoryStatus({
            available: false,
            state: "unavailable",
            message: error.message,
          });
          executionsRef.current = [];
          setExecutions([]);
          setExecutionTotal(0);
        } else {
          setExecutionError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (request === executionRequestRef.current) {
          setExecutionLoading(false);
          setMoreLoading(false);
        }
      }
    },
    [],
  );

  const loadAutomationList = useCallback(
    async (
      preferredId = "",
      options: { silent?: boolean; loadHistory?: boolean } = {},
    ) => {
      const request = listRequestRef.current + 1;
      listRequestRef.current = request;
      if (!options.silent) setListLoading(true);
      setListError("");
      try {
        const response = await getAutomations();
        if (request !== listRequestRef.current) return;
        const items = response.data.items || [];
        const status = response.data.executionHistory || INITIAL_HISTORY_STATUS;
        dispatch({ type: "SET_AUTOMATIONS", automations: items });
        setHistoryStatus(status);
        const currentId = preferredId || selectedIdRef.current;
        const nextId = items.some((item) => item.id === currentId)
          ? currentId
          : items[0]?.id || "";
        selectedIdRef.current = nextId;
        setSelectedId(nextId);
        if (!nextId) {
          executionsRef.current = [];
          setExecutions([]);
          setExecutionTotal(0);
          setExpandedId("");
        } else if (status.available && options.loadHistory !== false) {
          await loadExecutions(nextId, true, Boolean(options.silent));
        } else if (!status.available) {
          executionsRef.current = [];
          setExecutions([]);
          setExecutionTotal(0);
          setExpandedId("");
        }
      } catch (error) {
        if (request === listRequestRef.current) {
          setListError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (request === listRequestRef.current) setListLoading(false);
      }
    },
    [dispatch, loadExecutions],
  );

  useEffect(() => {
    void loadAutomationList();
  }, [loadAutomationList]);

  useEffect(() => {
    if (effectiveAgents.length > 0) return;
    let active = true;
    void fetchAutomationAgentsForSelect()
      .then((items) => {
        if (active) dispatch({ type: "SET_AGENTS", agents: items });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [dispatch, effectiveAgents.length]);

  useEffect(() => {
    const unsubscribe = push.subscribe(
      {
        types: [
          "automation.execution.created",
          "automation.execution.updated",
          "automation.execution.completed",
        ],
      },
      (frame) => {
        const payload = readPushPayload(frame);
        const automationId = String(payload.automationId || "").trim();
        if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current);
        pushTimerRef.current = window.setTimeout(() => {
          pushTimerRef.current = null;
          void loadAutomationList(selectedIdRef.current, {
            silent: true,
            loadHistory: automationId === selectedIdRef.current,
          });
        }, EXECUTION_PUSH_DEBOUNCE_MS);
      },
    );
    return () => {
      unsubscribe();
      if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current);
    };
  }, [loadAutomationList, push]);

  useEffect(() => {
    if (historyStatus.state === "ready") return undefined;
    const recheck = () => {
      if (document.visibilityState === "visible") {
        void loadAutomationList(selectedIdRef.current, { silent: true });
      }
    };
    const timer = window.setInterval(recheck, HISTORY_RECHECK_MS);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [historyStatus.state, loadAutomationList]);

  const selectAutomation = (id: string) => {
    if (id === selectedIdRef.current) return;
    executionRequestRef.current += 1;
    selectedIdRef.current = id;
    setSelectedId(id);
    setExecutions([]);
    setExecutionTotal(0);
    setExpandedId("");
    setExecutionError("");
    if (historyStatus.available) void loadExecutions(id, true);
  };

  const toggleSelected = async () => {
    if (!selected || actionBusy) return;
    setActionBusy(true);
    try {
      await toggleAutomation({ id: selected.id, enabled: !selected.enabled });
      await loadAutomationList(selected.id, { silent: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  };

  const duplicateSelected = async () => {
    if (!selected || actionBusy) return;
    setActionBusy(true);
    try {
      const detail = await getAutomation(selected.id);
      const name = t("automationConsole.copy.name", {
        name: detail.data.name || selected.id,
      });
      const created = await createAutomation(
        buildDuplicateAutomationPayload(detail.data, name),
      );
      await loadAutomationList(created.data.id, { silent: true });
      message.success(t("automationConsole.message.copySuccess", { name }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setActionBusy(false);
    }
  };

  const deleteSelected = () => {
    if (!selected || actionBusy) return;
    Modal.confirm({
      title: t("automationConsole.confirm.deleteTitle"),
      content: selected.name || selected.id,
      okText: t("automationConsole.confirm.deleteOk"),
      cancelText: t("automationConsole.confirm.deleteCancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        setActionBusy(true);
        try {
          await deleteAutomation({ id: selected.id });
          await loadAutomationList("", { silent: true });
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const loadExecutionDetail = useCallback(async (item: AutomationExecutionResponse) => {
    const request = detailRequestRef.current + 1;
    detailRequestRef.current = request;
    setResultExecution(item);
    setResultDetail(null);
    setResultLoading(true);
    setResultError("");
    try {
      const response = await getAutomationExecution({ executionId: item.id });
      if (request === detailRequestRef.current) setResultDetail(response.data);
    } catch (error) {
      if (request === detailRequestRef.current) {
        setResultError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (request === detailRequestRef.current) setResultLoading(false);
    }
  }, []);

  const openConversation = (item: AutomationExecutionResponse) => {
    if (!item.chatId) return;
    if (item.agentKey) {
      navigate(
        buildSurfaceRoute(
          { kind: "agent", agentKey: item.agentKey, chatId: item.chatId },
          readSurfacePresentationContext(location.search),
        ),
      );
      return;
    }
    navigate("/", {
      state: {
        automationConversation: {
          chatId: item.chatId,
          teamId: item.teamId,
        },
      },
    });
  };

  const moreSettingsMenu: MenuProps = {
    items: selected
      ? [
          {
            key: "copy",
            icon: <MaterialIcon name="content_copy" />,
            label: t("automationConsole.action.copy"),
            onClick: () => void duplicateSelected(),
          },
        ]
      : [],
  };

  const renderAutomationItem = (item: AutomationSummaryResponse) => {
    const agent = agentByKey.get(String(item.agentKey || ""));
    const last = item.lastExecution;
    return (
      <button
        type="button"
        key={item.id}
        className={`${styles.automationItem} ${item.id === selectedId ? styles.active : ""}`}
        onClick={() => selectAutomation(item.id)}
      >
        <span className={styles.itemCopy}>
          <span className={styles.itemTitleRow}>
            <span className={styles.itemName} title={item.name || item.id}>
              {item.name || item.id}
            </span>
            <span className={`${styles.enableState} ${item.enabled ? styles.enabled : ""}`}>
              <span className={styles.enableDot} aria-hidden="true" />
              {item.enabled
                ? t("automationConsole.status.enabled")
                : t("automationHistory.status.paused")}
            </span>
          </span>
          <span className={styles.itemSchedule}>
            <span>{describeCronExpression(item.cron, t)}</span>
            <span className={styles.itemWorker}>
              {item.teamId ? (
                <MaterialIcon name="hub" />
              ) : (
                <AgentIcon
                  icon={agent?.icon}
                  type="agent"
                  props={{
                    icon: { width: 14, height: 14 },
                    avatar: { size: 14, icon: <MaterialIcon name="smart_toy" /> },
                  }}
                />
              )}
              {automationWorkerLabel(item, agentByKey, teamById)}
            </span>
          </span>
          <span className={styles.itemLast}>
            <span>
              {last
                ? t("automationHistory.last.label", { time: last.startedTime || "--" })
                : t("automationHistory.last.never")}
              {last ? (
                <span className={`${styles.lastStatus} ${styles[last.status]}`}>
                  <MaterialIcon name={STATUS_ICON[last.status]} />
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className={styles.console}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <div className={styles.sidebarSearchRow}>
            <Input
              allowClear
              prefix={<MaterialIcon name="search" />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("automationConsole.searchPlaceholder")}
            />
            <Tooltip title={t("automationConsole.action.new")}>
              <UiButton
                size="sm"
                variant="primary"
                iconOnly
                className={`${styles.newButton} ui-icon-hover-24`}
                aria-label={t("automationConsole.action.new")}
                onClick={() => {
                  setEditorAutomationId("");
                  setEditorOpen(true);
                }}
              >
                <MaterialIcon name="add" />
              </UiButton>
            </Tooltip>
          </div>
        </div>

        <div className={styles.automationList}>
          <Spin spinning={listLoading}>
            {listError ? (
              <div className={styles.listError}>
                <span>{listError}</span>
                <UiButton size="sm" variant="ghost" onClick={() => void loadAutomationList(selectedId)}>
                  {t("automationConsole.action.retry")}
                </UiButton>
              </div>
            ) : filteredAutomations.length === 0 ? (
              <div className={styles.emptyList}>{t("automationConsole.empty")}</div>
            ) : (
              <>
                {enabledAutomations.length ? (
                  <section className={styles.automationGroup}>
                    <h2>{t("automationHistory.group.enabled", { count: enabledAutomations.length })}</h2>
                    {enabledAutomations.map(renderAutomationItem)}
                  </section>
                ) : null}
                {disabledAutomations.length ? (
                  <section className={styles.automationGroup}>
                    <h2>{t("automationHistory.group.paused", { count: disabledAutomations.length })}</h2>
                    {disabledAutomations.map(renderAutomationItem)}
                  </section>
                ) : null}
              </>
            )}
          </Spin>
        </div>
      </aside>

      <section className={styles.main}>
        {selected ? (
          <>
            <header className={styles.mainHeader}>
              <div className={styles.overviewCopy}>
                <span className={styles.overviewIcon}>
                  <MaterialIcon name="bar_chart" />
                </span>
                <div className={styles.overviewContent}>
                  <h2>{t("automationHistory.overview.title")}</h2>
                  <div className={styles.overviewStats}>
                    <span>
                      <small>{t("automationHistory.overview.total")}</small>
                      <strong>{executionTotal}</strong>
                    </span>
                    <span>
                      <small>{t("automationHistory.overview.last")}</small>
                      <strong className={selected.lastExecution ? styles[selected.lastExecution.status] : ""}>
                        {selected.lastExecution
                          ? t(`automationHistory.status.${selected.lastExecution.status}`)
                          : t("automationHistory.last.never")}
                      </strong>
                    </span>
                    <span>
                      <small>{t("automationHistory.overview.next")}</small>
                      <strong>{selected.nextFireTime || "--"}</strong>
                    </span>
                  </div>
                </div>
              </div>
              <div className={styles.headerActions}>
                <UiButton
                  size="sm"
                  variant="secondary"
                  className="ui-icon-hover-24"
                  onClick={() => {
                    setEditorAutomationId(selected.id);
                    setEditorOpen(true);
                  }}
                >
                  <MaterialIcon name="edit" className="ui-icon-hover-24-target" />
                  {t("automationHistory.action.edit")}
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  className="ui-icon-hover-24"
                  disabled={actionBusy}
                  onClick={() => void toggleSelected()}
                >
                  <MaterialIcon
                    name={selected.enabled ? "pause_circle" : "play_circle"}
                    className="ui-icon-hover-24-target"
                  />
                  {selected.enabled
                    ? t("automationConsole.action.disable")
                    : t("automationConsole.action.enable")}
                </UiButton>
                <UiButton
                  size="sm"
                  variant="ghost"
                  className={`${styles.deleteAction} ui-icon-hover-24`}
                  disabled={actionBusy}
                  onClick={deleteSelected}
                >
                  <MaterialIcon name="delete" className="ui-icon-hover-24-target" />
                  {t("automationConsole.action.delete")}
                </UiButton>
                <Dropdown menu={moreSettingsMenu} trigger={["click"]} placement="bottomRight">
                  <UiButton
                    size="sm"
                    variant="ghost"
                    className="ui-icon-hover-24"
                    loading={actionBusy}
                    aria-label={t("automationHistory.action.moreSettings")}
                  >
                    <MaterialIcon name="more_horiz" className="ui-icon-hover-24-target" />
                    {t("automationHistory.action.moreSettings")}
                  </UiButton>
                </Dropdown>
              </div>
            </header>

            <div className={styles.historyBody}>
              <div className={styles.historyHeading}>
                <h3>{t("automationHistory.title")}</h3>
                <div className={styles.historyHeadingActions}>
                  <span>{t("automationHistory.count", { count: executionTotal })}</span>
                  <Tooltip title={t("automationConsole.action.refresh")}>
                    <UiButton
                      size="sm"
                      variant="ghost"
                      iconOnly
                      className="ui-icon-hover-24"
                      aria-label={t("automationConsole.action.refresh")}
                      onClick={() => void loadAutomationList(selected.id)}
                      disabled={executionLoading}
                    >
                      <MaterialIcon name="refresh" />
                    </UiButton>
                  </Tooltip>
                </div>
              </div>

              {historyStatus.state !== "ready" ? (
                <div
                  className={`${styles.historyNotice} ${historyStatus.available ? styles.degradedNotice : ""}`}
                >
                  <MaterialIcon name={historyStatus.available ? "warning" : "error"} />
                  <div>
                    <strong>
                      {t(`automationHistory.historyState.${historyStatus.state}`)}
                    </strong>
                    <p>
                      {historyStatus.message || t("automationHistory.historyState.fallback")}
                    </p>
                  </div>
                  <UiButton
                    size="sm"
                    variant="ghost"
                    onClick={() => void loadAutomationList(selected.id)}
                  >
                    {t("automationHistory.action.recheck")}
                  </UiButton>
                </div>
              ) : null}

              {executionError ? (
                <div className={styles.executionError}>
                  <span>{executionError}</span>
                  <UiButton size="sm" variant="ghost" onClick={() => void loadExecutions(selected.id, true)}>
                    {t("automationConsole.action.retry")}
                  </UiButton>
                </div>
              ) : null}

              <Spin spinning={executionLoading}>
                {historyStatus.available && executions.length === 0 && !executionLoading ? (
                  <div className={styles.emptyHistory}>
                    <MaterialIcon name="history" />
                    <h3>{t("automationHistory.empty.title")}</h3>
                    <p>
                      {selected.enabled
                        ? t("automationHistory.empty.enabled")
                        : t("automationHistory.empty.paused")}
                    </p>
                  </div>
                ) : (
                  <div className={styles.timeline}>
                    {groupedExecutions.map((group) => (
                      <section className={styles.dayGroup} key={group.key}>
                        <h4>{group.label}</h4>
                        <div className={styles.dayRows}>
                          {group.items.map((item) => {
                            const expanded = item.id === expandedId;
                            const preview = automationExecutionPreview(item, {
                              running: t("automationHistory.preview.running"),
                              empty: t("automationHistory.preview.empty"),
                            });
                            return (
                              <article className={styles.executionRow} key={item.id}>
                                <span className={`${styles.timelineMarker} ${styles[item.status]}`}>
                                  <MaterialIcon name={STATUS_ICON[item.status]} />
                                </span>
                                <button
                                  type="button"
                                  className={styles.executionSummary}
                                  onClick={() => setExpandedId(expanded ? "" : item.id)}
                                  aria-expanded={expanded}
                                >
                                  <time>{automationExecutionTimeLabel(item, locale)}</time>
                                  <span className={`${styles.status} ${styles[item.status]}`}>
                                    {t(`automationHistory.status.${item.status}`)}
                                  </span>
                                  <span className={styles.duration}>
                                    {automationExecutionDurationLabel(item.durationMs)}
                                  </span>
                                  <span className={styles.preview}>{preview}</span>
                                  <MaterialIcon
                                    name={expanded ? "keyboard_arrow_down" : "keyboard_arrow_right"}
                                    className={styles.chevron}
                                  />
                                </button>
                                {expanded ? (
                                  <div className={styles.executionDetail}>
                                    <div className={styles.executionMeta}>
                                      <span>{automationExecutionDateTimeLabel(item, locale)}</span>
                                      {item.runId ? (
                                        <button type="button" onClick={() => void copyText(item.runId || "")}>
                                          {item.runId}
                                          <MaterialIcon name="content_copy" />
                                        </button>
                                      ) : null}
                                      <span>{item.finishReason || "--"}</span>
                                    </div>
                                    {item.error ? <p className={styles.executionInlineError}>{item.error}</p> : null}
                                    <div className={styles.executionActions}>
                                      {item.hasResult ? (
                                        <button type="button" onClick={() => void loadExecutionDetail(item)}>
                                          {t("automationHistory.action.viewResult")}
                                        </button>
                                      ) : null}
                                      {item.chatId && (item.agentKey || item.teamId) ? (
                                        <button type="button" onClick={() => openConversation(item)}>
                                          {t("automationHistory.action.openConversation")}
                                          <MaterialIcon name="open_in_new" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                    {executions.length < executionTotal ? (
                      <UiButton
                        className={styles.loadMore}
                        size="sm"
                        variant="ghost"
                        loading={moreLoading}
                        onClick={() => void loadExecutions(selected.id, false)}
                      >
                        <MaterialIcon name="keyboard_arrow_down" />
                        {t("automationHistory.action.loadMore")}
                      </UiButton>
                    ) : null}
                  </div>
                )}
              </Spin>
            </div>
          </>
        ) : (
          <div className={styles.emptySelection}>
            <MaterialIcon name="schedule" />
            <h2>{t("automationHistory.empty.automations")}</h2>
            <UiButton
              size="sm"
              variant="primary"
              onClick={() => {
                setEditorAutomationId("");
                setEditorOpen(true);
              }}
            >
              <MaterialIcon name="add" />
              {t("automationConsole.action.create")}
            </UiButton>
          </div>
        )}
      </section>

      <AutomationEditorDrawer
        open={editorOpen}
        automationId={editorAutomationId}
        currentWorker={currentWorker}
        agents={effectiveAgents}
        teams={effectiveTeams}
        onClose={() => setEditorOpen(false)}
        onSaved={(id) => {
          setEditorOpen(false);
          void loadAutomationList(id);
        }}
        onDeleted={() => {
          setEditorOpen(false);
          void loadAutomationList();
        }}
      />
      <AutomationResultDrawer
        execution={resultExecution}
        detail={resultDetail}
        loading={resultLoading}
        error={resultError}
        onClose={() => {
          detailRequestRef.current += 1;
          setResultExecution(null);
          setResultDetail(null);
          setResultError("");
        }}
        onOpenConversation={openConversation}
        onRetryDetail={() => {
          if (resultExecution) void loadExecutionDetail(resultExecution);
        }}
      />
    </div>
  );
}
