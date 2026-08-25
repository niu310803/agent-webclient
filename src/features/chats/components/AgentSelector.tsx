import React, { useMemo } from "react";
import { Dropdown } from "antd";
import { useAppContext } from "@/app/state/provider";
import { AgentIcon } from "@/shared/icons/agent";
import { MaterialIcon } from "@/shared/ui/MaterialIcon";
import { useI18n } from "@/shared/i18n";

const ICON_PROPS = {
  icon: {
    className: "history-worker-option-icon",
    width: 20,
    height: 20,
  },
  avatar: {
    className: "history-worker-option-icon",
    size: 20,
  },
};

export const AgentSelector: React.FC<{
  value?: string[];
  onChange: (agentKeys: string[]) => void;
}> = ({ value = [], onChange }) => {
  const { t } = useI18n();
  const { state } = useAppContext();
  const agents = useMemo(
    () => (Array.isArray(state.agents) ? state.agents : []),
    [state.agents],
  );
  const selectedKeys = useMemo(
    () =>
      value
        .map((key) =>
          String(key || "").startsWith("agent:")
            ? String(key).slice("agent:".length)
            : String(key || ""),
        )
        .filter(Boolean),
    [value],
  );
  const selectedAgents = useMemo(
    () => agents.filter((agent) => selectedKeys.includes(agent.key)),
    [agents, selectedKeys],
  );
  const triggerLabel =
    selectedAgents.length === 0
      ? t("history.agentSelector.all")
      : selectedAgents.length === 1
        ? selectedAgents[0].name || selectedAgents[0].key
        : t("history.agentSelector.selectedCount", {
            count: selectedAgents.length,
          });
  const menuItems = useMemo(
    () =>
      agents.map((agent) => ({
        key: agent.key,
        label: (
          <span className="history-worker-option">
            <AgentIcon icon={agent.icon} type="agent" props={ICON_PROPS} />
            <span className="history-worker-option-name">
              {agent.name || agent.key}
            </span>
            {selectedKeys.includes(agent.key) ? (
              <MaterialIcon
                name="check"
                className="history-worker-option-check"
              />
            ) : null}
          </span>
        ),
      })),
    [agents, selectedKeys],
  );

  return (
    <Dropdown
      menu={{
        items: menuItems,
        selectable: true,
        multiple: true,
        selectedKeys,
        onClick: ({ key }) => {
          const agentKey = String(key);
          const next = selectedKeys.includes(agentKey)
            ? selectedKeys.filter((item) => item !== agentKey)
            : [...selectedKeys, agentKey];
          onChange(next);
        },
      }}
      trigger={["click"]}
      placement="bottomLeft"
    >
      <button
        type="button"
        className="history-worker-selector"
        aria-label={t("history.workerSelector.ariaLabel")}
      >
        {selectedAgents.length === 1 ? (
          <AgentIcon
            icon={selectedAgents[0].icon}
            type="agent"
            props={{
              icon: {
                className: "history-worker-selector-icon",
                width: 20,
                height: 20,
              },
              avatar: {
                className: "history-worker-selector-icon",
                size: 20,
              },
            }}
          />
        ) : null}
        <span className="history-worker-selector-name">{triggerLabel}</span>
        <MaterialIcon
          name="expand_more"
          className="history-worker-selector-chevron"
        />
      </button>
    </Dropdown>
  );
};
