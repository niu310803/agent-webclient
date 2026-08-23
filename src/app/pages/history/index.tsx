import React from "react";
import { Button, DatePicker, Input, Select, Spin } from "antd";
import type { Dayjs } from "dayjs";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Agent, Chat, Team, WorkerListItem } from "@/app/state/types";
import { getAgents, getChats } from "@/shared/data";
import {
  ALL_HISTORY_OWNERS,
  buildGlobalHistoryOwnerOptions,
  filterGlobalHistoryChats,
  resolveGlobalHistoryRowText,
  type HistoryOwnerKey,
} from "@/features/chats/lib/globalHistory";
import {
  readInitialHistoryOwnerKey,
  resolveLoadedHistoryOwnerKey,
} from "@/features/chats/lib/historyRoute";
import { splitWorkerListItems } from "@/features/workers/lib/workerDataCoordinator";
import { useI18n } from "@/shared/i18n";
import { MaterialIcon } from "@/shared/ui/MaterialIcon";
import {
  buildSurfaceRoute,
  readSurfacePresentationContext,
} from "@/features/surfaces/surfaceRoutes";

type HistoryDateRange = [Dayjs | null, Dayjs | null] | null;

function chatAgentKey(chat: Chat): string {
  return String(chat.agentKey || chat.firstAgentKey || "").trim();
}

export const HistoryPage: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [routeSearch] = useSearchParams();
  const [query, setQuery] = React.useState("");
  const [ownerKey, setOwnerKey] = React.useState<HistoryOwnerKey>(() =>
    readInitialHistoryOwnerKey(routeSearch),
  );
  const [dateRange, setDateRange] = React.useState<HistoryDateRange>(null);
  const [chats, setChats] = React.useState<Chat[]>([]);
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [teams, setTeams] = React.useState<Team[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [ownersLoaded, setOwnersLoaded] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let disposed = false;
    setLoading(true);
    setOwnersLoaded(false);
    setError("");

    void getChats()
      .then((response) => {
        if (!disposed) {
          setChats(Array.isArray(response.data) ? (response.data as Chat[]) : []);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    void getAgents({ includeTeam: true, scope: "nav" })
      .then((response) => {
        if (disposed) return;
        const workers = splitWorkerListItems(
          Array.isArray(response.data)
            ? (response.data as WorkerListItem[])
            : [],
        );
        setAgents(workers.agents);
        setTeams(workers.teams);
      })
      .catch(() => {
        if (disposed) return;
        setAgents([]);
        setTeams([]);
      })
      .finally(() => {
        if (!disposed) setOwnersLoaded(true);
      });

    return () => {
      disposed = true;
    };
  }, []);

  const ownerOptions = React.useMemo(
    () => buildGlobalHistoryOwnerOptions({ agents, chats, teams }),
    [agents, chats, teams],
  );
  React.useEffect(() => {
    const resolvedOwnerKey = resolveLoadedHistoryOwnerKey({
      ownerKey,
      ownerOptions,
      loading: loading || !ownersLoaded,
    });
    if (resolvedOwnerKey !== ownerKey) setOwnerKey(resolvedOwnerKey);
  }, [loading, ownerKey, ownerOptions, ownersLoaded]);
  const startAt = dateRange?.[0]?.startOf("day").valueOf();
  const endAt = dateRange?.[1]?.endOf("day").valueOf();
  const rows = React.useMemo(
    () =>
      filterGlobalHistoryChats(chats, {
        query,
        ownerKey,
        startAt,
        endAt,
      }),
    [chats, endAt, ownerKey, query, startAt],
  );
  const hasFilters = Boolean(
    query.trim() || ownerKey !== ALL_HISTORY_OWNERS || dateRange,
  );

  const resetFilters = () => {
    setQuery("");
    setOwnerKey(ALL_HISTORY_OWNERS);
    setDateRange(null);
  };

  const openChat = (chat: Chat) => {
    const agentKey = chatAgentKey(chat);
    if (!agentKey) return;
    navigate(
      buildSurfaceRoute(
        { kind: "agent", agentKey, chatId: chat.chatId },
        readSurfacePresentationContext(routeSearch.toString()),
      ),
    );
  };

  return (
    <main className="tw:flex tw:h-screen tw:flex-col tw:bg-bg-base tw:text-ink-1">
      <header className="tw:flex tw:items-center tw:gap-3 tw:border-b tw:border-line-soft tw:px-5 tw:py-4">
        <MaterialIcon name="history" />
        <strong>{t("leftSidebar.historyTitle")}</strong>
        <span className="tw:text-xs tw:text-ink-muted">
          {t("history.global.count", { filtered: rows.length, total: chats.length })}
        </span>
      </header>
      <div className="tw:grid tw:grid-cols-1 tw:gap-3 tw:border-b tw:border-line-soft tw:p-4 tw:md:grid-cols-[minmax(220px,1fr)_minmax(220px,320px)_minmax(260px,340px)_auto]">
        <Input
          value={query}
          allowClear
          placeholder={t("history.searchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          value={ownerKey}
          aria-label={t("history.global.owner.ariaLabel")}
          options={[
            {
              value: ALL_HISTORY_OWNERS,
              label: t("history.global.owner.all"),
            },
            ...ownerOptions.map((option) => ({
              value: option.key,
              label: `${t(`worker.kindLabel.${option.type}`)} · ${option.label}`,
            })),
          ]}
          onChange={(value) => setOwnerKey(value as HistoryOwnerKey)}
        />
        <DatePicker.RangePicker
          value={dateRange}
          allowClear
          format="YYYY-MM-DD"
          aria-label={t("history.global.date.ariaLabel")}
          placeholder={[
            t("history.global.date.start"),
            t("history.global.date.end"),
          ]}
          onChange={(value) =>
            setDateRange(value ? [value[0], value[1]] : null)
          }
        />
        <Button disabled={!hasFilters} onClick={resetFilters}>
          {t("history.global.reset")}
        </Button>
      </div>
      <section className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:px-4 tw:py-4">
        {loading ? (
          <div className="tw:grid tw:h-full tw:place-items-center">
            <Spin />
          </div>
        ) : null}
        {error ? (
          <div className="system-alert" role="alert">
            {error}
          </div>
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <div className="command-empty-state">{t("history.global.empty")}</div>
        ) : null}
        <div className="tw:flex tw:flex-col tw:gap-2">
          {rows.map((chat) => {
            const agentKey = chatAgentKey(chat);
            const rowText = resolveGlobalHistoryRowText(chat, {
              title: t("leftSidebar.titleUntitled"),
              lastContent: t("history.noPreview"),
            });
            return (
              <button
                key={chat.chatId}
                type="button"
                disabled={!agentKey}
                className="tw:flex tw:w-full tw:flex-col tw:gap-1 tw:rounded-xl tw:border tw:border-line-soft tw:bg-bg-card tw:px-4 tw:py-3 tw:text-left tw:hover:border-accent tw:disabled:cursor-not-allowed tw:disabled:opacity-50"
                onClick={() => openChat(chat)}
              >
                <strong className="tw:block tw:w-full tw:truncate">
                  {rowText.title}
                </strong>
                <span className="tw:block tw:w-full tw:truncate tw:text-xs tw:text-ink-muted">
                  {rowText.lastContent}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
};
