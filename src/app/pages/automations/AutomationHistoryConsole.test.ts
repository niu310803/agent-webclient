import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("Automation Run now contracts", () => {
  const consoleSource = readSource(
    "src/app/pages/automations/AutomationHistoryConsole.tsx",
  );

  it("places Run now in the selected detail More settings menu", () => {
    const menuStart = consoleSource.indexOf("const moreSettingsMenu");
    const itemStart = consoleSource.indexOf("const renderAutomationItem");
    const menuSource = consoleSource.slice(menuStart, itemStart);
    const itemSource = consoleSource.slice(itemStart, consoleSource.indexOf("\n  return (", itemStart));

    expect(menuSource).toContain('key: "trigger"');
    expect(menuSource).toContain("automationConsole.action.triggerNow");
    expect(menuSource).toContain("triggerAutomationItem(selected)");
    expect(menuSource).toContain("disabled: selectedTriggering");
    expect(itemSource).not.toContain("triggerAutomationItem");
    expect(itemSource).not.toContain("triggerButton");
    expect(consoleSource).toContain("enabledAutomations.map(renderAutomationItem)");
    expect(consoleSource).toContain("disabledAutomations.map(renderAutomationItem)");
  });

  it("tracks menu trigger loading by Automation ID", () => {
    expect(consoleSource).toContain("const [triggeringIds, setTriggeringIds]");
    expect(consoleSource).toContain("triggeringIdsRef.current.has(item.id)");
    expect(consoleSource).toContain("triggeringIdsRef.current.add(item.id)");
    expect(consoleSource).toContain("triggeringIdsRef.current.delete(item.id)");
    expect(consoleSource).toContain("triggeringIds.has(selected.id)");
    expect(consoleSource).toContain('name={selectedTriggering ? "progress_activity" : "bolt"}');
  });

  it("removes the legacy query-simulated run path", () => {
    const modalSource = readSource("src/app/modals/AutomationModal.tsx");

    expect(modalSource).not.toContain("executeQueryOnce");
    expect(modalSource).not.toContain("runAutomationOnce");
    expect(modalSource).not.toContain('key: "run"');
  });
});
