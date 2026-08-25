import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSelector } from "@/features/chats/components/AgentSelector";
import { I18nProvider } from "@/shared/i18n";

jest.mock("antd", () => ({
  Dropdown: ({ children, menu, ...props }: any) =>
    React.createElement(
      "div",
      props,
      children,
      menu.items.map((item: any) =>
        React.createElement("div", { key: item.key, "data-menu-key": item.key }, item.label),
      ),
    ),
}));

jest.mock("@/app/state/provider", () => ({
  useAppContext: () => ({
    state: {
      agents: [
        { key: "alpha", name: "Alpha", icon: { name: "focus" } },
        { key: "beta", name: "Beta" },
      ],
    },
    dispatch: jest.fn(),
  }),
}));

jest.mock("@/shared/icons/agent", () => ({
  AgentIcon: ({ type }: { type: string }) =>
    React.createElement("svg", { "data-agent-type": type }),
}));

jest.mock("@/shared/ui/MaterialIcon", () => ({
  MaterialIcon: ({ name }: { name: string }) =>
    React.createElement("svg", { "data-material-icon": name }),
}));

function renderAgentSelector(
  props: Partial<React.ComponentProps<typeof AgentSelector>> = {},
) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { locale: "zh-CN", persistLocale: false },
      React.createElement(AgentSelector, {
        value: ["alpha"],
        onChange: jest.fn(),
        ...props,
      }),
    ),
  );
}

describe("AgentSelector", () => {
  it("lists agents from state and marks selected agents with a check", () => {
    const html = renderAgentSelector({ value: ["alpha"] });

    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain('data-menu-key="alpha"');
    expect(html).toContain('data-menu-key="beta"');
    expect(html).toContain('data-agent-type="agent"');
    expect(html).toContain('data-material-icon="check"');
  });

  it("shows the single selected agent name as the trigger label", () => {
    const html = renderAgentSelector({ value: ["beta"] });

    expect(html).toContain("Beta");
  });

  it("shows the selected count when multiple agents are selected", () => {
    const html = renderAgentSelector({ value: ["alpha", "beta"] });

    expect(html).toContain("已选 2 个");
  });

  it("shows the all-agents label when nothing is selected", () => {
    const html = renderAgentSelector({ value: [] });

    expect(html).toContain("全部智能体");
  });
});
