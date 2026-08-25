# Automation页面

## 当前状态
Automation 页面由 `/automations` 路由进入，页面入口是 `src/app/pages/automations/index.tsx`，主体为 `AutomationHistoryConsole`。页面采用 history-first 信息架构：左侧选择 Automation，右侧首先查看最近触发及其结果；配置编辑与完整结果分别进入独立右侧 Drawer。

## 核心职责
- 展示 automation 列表，并按启用中/已暂停分组；每项显示调度、Agent/Team 和最近一次触发。
- 按日期时间轴展示最近 Execution，覆盖 `running/success/failed/canceled` 四种状态、耗时、两行内结果摘要和轻量展开详情。
- 在用户明确点击“查看完整结果”后按需加载 `resultContent`，并复用 `MarkdownContent` 渲染；列表接口不读取完整助手输出。
- 支持创建和编辑 cron、zoneId、remainingRuns、agentKey/teamId 与 query payload；description、zoneId、query.role、query.hidden 均可省略。
- 支持启停、复制、删除自动化，不提供伪造的“运行一次”或失败重试入口。
- 为 message、role、hidden 和 params JSON 提供前端表单编辑与基本校验。

## 核心流程
进入 `/automations` 后，页面通过 `POST /api/automations` 加载配置列表和 `executionHistory` 服务状态，默认选中第一条 Automation；History 可用时通过 `POST /api/automation/executions` 按 20 条分页加载当前 Automation 的历史，并默认展开最近一次。分页根据 `executionId` 去重，切换、分页和详情请求均使用请求序号忽略迟到响应。

页面订阅 `automation.execution.created/updated/completed`：当前 Automation 的事件会防抖刷新第一页和列表摘要，其他 Automation 的事件只刷新左栏摘要。`initializing/unavailable` 会显示明确的 History 提示且不影响配置操作；`degraded` 继续展示仍可读取的历史。历史接口 503 只隔离右侧历史，不伪装成空记录。

Execution 行保持 48–56px 的高密度布局；`resultPreview` 最多两行。展开区不重复结果摘要，仅展示完整时间、Run ID、finish reason、错误信息和操作，并使用留白、浅背景与行分隔表达层级，不增加卡片边框。完整结果通过 `POST /api/automation/execution` 按需读取，可复制结果、Execution ID、Run ID、查看触发 Query 和打开对话。

Agent Execution 使用 `/agent/:agentKey?chatId=...` 深链；Team Execution 通过一次性路由 state 进入主界面，触发既有 `agent:load-chat` 事件后立即清除 state。

新建和编辑均在约 `min(680px, 100vw)` 的右侧 Drawer 中复用 `AutomationModal` 的 editor-only 模式，保留结构化/源码编辑、Cron 常用项、校验、启停和删除能力，并在关闭前检查未保存修改。命令抽屉/弹窗仍复用同一个 `AutomationModal`，不存在第二套字段与 payload 规则。

桌面左栏固定约 288px；860px 以下改为上下布局，列表限制高度并独立滚动；560px 以下进一步收紧 Execution 列。两个 Drawer 在窄屏均使用全宽。

## 边界与非目标
- Automation 调度、cron 解释、执行上下文和失败重试由后端负责。
- 前端不生成自动化执行计划，也不调用普通 `/api/query` 模拟单次运行或重试。
- Automation 管理接口当前固定走 HTTP，不随对话 WebSocket transport 路由。
- 完整结果只存在于单条 Execution 详情响应，历史列表只消费 `hasResult/resultPreview`。
- 省略 `query.role` 时按 `automation` 执行，省略 `query.hidden` 时默认隐藏该 query 消息；显式 `hidden: false` 才在 Chat 时间线显示。省略 `zoneId` 时跟随 Platform 当前时区。

## 相关文件
- `../src/app/pages/automations/index.tsx`
- `../src/app/pages/automations/AutomationHistoryConsole.tsx`
- `../src/app/pages/automations/AutomationHistoryConsole.module.css`
- `../src/app/modals/AutomationModal.tsx`
- `../src/features/automations/lib/executionView.ts`
- `../src/shared/data/api/client.ts`
- `../src/shared/data/api/routedClient.ts`
- `../src/shared/data/api/endpoints.ts`
- `../src/shared/data/api/client.test.ts`
