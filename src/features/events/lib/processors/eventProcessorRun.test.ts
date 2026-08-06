import type { TaskItemMeta } from "@/app/state/types";
import type { EventProcessorState } from "@/features/events/lib/eventProcessorTypes";
import { processRunEvent } from "@/features/events/lib/processors/eventProcessorRun";

function createProcessorState(tasks: Map<string, TaskItemMeta>): EventProcessorState {
  return {
    getContentNodeId: () => undefined,
    getReasoningNodeId: () => undefined,
    getToolNodeId: () => undefined,
    getToolState: () => undefined,
    getTimelineNode: () => undefined,
    getNodeText: () => "",
    nextCounter: () => 0,
    peekCounter: () => 0,
    activeReasoningKey: "",
    chatId: "chat_1",
    runId: "run_1",
    currentRunningPlanTaskId: "task_1",
    getTaskItem: (taskId) => tasks.get(taskId),
    getActiveTaskIds: () => Array.from(tasks.keys()),
    getPlanTaskDescription: () => undefined,
    getPlanId: () => "plan_1",
  };
}

describe("processRunEvent", () => {
  it.each([
    ["run.complete", "completed"],
    ["run.cancel", "canceled"],
    ["run.error", "failed"],
  ])("settles active plan tasks when %s closes the run", (type, status) => {
    const tasks = new Map<string, TaskItemMeta>([
      ["task_1", {
        taskId: "task_1",
        taskName: "最后一项",
        taskGroupId: "group_1",
        runId: "run_1",
        status: "running",
        startedAt: 100,
        updatedAt: 100,
        error: "",
      }],
    ]);

    const commands = processRunEvent(
      {
        type,
        runId: "run_1",
        timestamp: 250,
        ...(type === "run.error" ? { error: "failed" } : {}),
      },
      createProcessorState(tasks),
      { mode: "live", reasoningExpandedDefault: false },
    );

    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cmd: "SET_TASK_ITEM_META",
        taskId: "task_1",
        task: expect.objectContaining({ status, endedAt: 250, durationMs: 150 }),
      }),
      { cmd: "REMOVE_ACTIVE_TASK_ID", taskId: "task_1" },
      expect.objectContaining({
        cmd: "SET_PLAN_RUNTIME",
        taskId: "task_1",
        runtime: expect.objectContaining({ status }),
      }),
      { cmd: "SET_PLAN_CURRENT_RUNNING_TASK_ID", taskId: "" },
    ]));
  });

  it("does not settle an active task owned by another run", () => {
    const tasks = new Map<string, TaskItemMeta>([
      ["task_other", {
        taskId: "task_other",
        taskName: "其他运行",
        taskGroupId: "group_other",
        runId: "run_other",
        status: "running",
        startedAt: 100,
        updatedAt: 100,
        error: "",
      }],
    ]);

    const commands = processRunEvent(
      { type: "run.complete", runId: "run_1", timestamp: 250 },
      createProcessorState(tasks),
      { mode: "live", reasoningExpandedDefault: false },
    );

    expect(commands).toEqual([]);
  });
});
