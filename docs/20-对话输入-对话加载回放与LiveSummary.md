# 对话加载回放与LiveSummary

## 当前状态

历史聊天目录、live summary、未读状态和 CRUD UI 由 `src/features/chats/` 负责；当前对话加载、切换、快照和回放由 `src/features/conversation/` 负责。回放事件与实时事件共用 `src/features/events/` 的纯投影入口。

## 核心职责

- 加载对话摘要并合并运行中对话的 live patch。
- 切换 chat 时恢复 conversation snapshot、timeline、plan、artifacts 和当前 agent 绑定。
- replay 后用 `/api/chat.awaiting` 校准 Composer 的唯一可操作等待态。
- 根据 pending awaiting、active run、未读计数更新 worker 列表展示。
- 支持删除、重命名、归档、标记已读和导出。

## 核心流程

`useConversationActions` 拉取对话详情，并把详情事件按 replay 模式交给事件处理器；`useConversationEventHandler` 处理实时事件。两条路径生成相同的 `EventCommand`，再分别由 replay/live adapter 应用。历史 replay 完成后，`reconcileReplayAwaiting` 读取顶层 `/api/chat.awaiting`：没有顶层等待项时清空 replay 产生的活动队列；存在时按 `runId + awaitingId + mode` 精确匹配完整 ask，planning 先映射为前端 plan。该校准只改变 Composer 操作态，不删除历史 events 或 debug timeline；协议不一致时记录诊断并保持输入框解锁。

`useChatReadSync` 独立同步已读状态，worker 选择逻辑位于 workers 模块。`/agent/:agentKey?newChat=` 的首条 query 仅在收到稳定 `chatId` 后将路由 replace 为 `?chatId=`；这是同一 live query 的一次性 session promotion，不是历史对话打开。`AgentChatShell` 消费 promotion 后只收敛 URL 和选中态，不派发 `agent:load-chat`；`useConversationActions.loadChat()` 也会在目标 chat 已由活跃 live query 消费时直接返回，不拉取 `/api/chat`、不 reset timeline、也不派发 attach。

### Chat 切换事务

历史切换由 `AppState.chatTransition` 表示，阶段固定为 `loading → applying → restoring → ready`，失败进入 `error`。事务身份使用全局递增的 `chatLoadSeq`，所有请求结果、重试、原子应用和滚动恢复都必须同时匹配 `seq + targetChatId`；较早的 A→B 请求即使晚于 A→C 返回，也不能再修改可见状态。

切换开始时，`useConversationActions` 先通过 AppContext 中的 viewport handle 同步保存来源 Chat 阅读位置，再创建事务。请求期间保留来源 timeline，不再用 `streaming=true` 模拟历史加载，也不提前清空事件；`ConversationStage` 只为阻塞型历史事务或不属于当前原生 live query 的路由目标覆盖骨架层，因此历史路由变化首帧不会闪现旧 Chat，而 new Chat 的 canonical URL promotion 始终保留实时 Timeline。判断只认可 `observationSource !== "attach"` 的原 query session；若 route-driven 历史事务已与该 promotion 竞态创建，时间线立即清除该事务，使其迟到响应失效且不继续锁定 Composer。历史响应一旦返回带非空 `runId` 的 `activeRun`，Chat ID、reset、replay 投影和 `currentChatActiveRun` 在同一个 `flushSync` 批次内应用，并将该事务提升为粘性的后台恢复模式：Timeline 与 Composer 立即可用，attach、增量事件接收和阅读位置恢复继续执行，运行恰好完成也不会重新闪回骨架层。没有 `activeRun` 的历史响应仍保持阻塞，直到位置恢复推进 `ready`。失败时来源数据继续保留在错误层后方，错误层始终可见，重试创建新事务，不提交空目标会话。

`forceReload` 使用 `same-chat-reload` 并执行同样的保存与恢复。新建空白对话会先保存来源位置、取消当前事务，再 reset；新 Chat 获得 canonical `chatId` 的 session promotion 仍绕过历史加载事务。事务处于加载、应用、恢复或错误阶段时，Composer 及旧的 awaiting、plan、frontend tool 交互均不可提交；需要聚焦 Composer 的切换只在恢复完成后派发，并使用 `preventScroll`。

导出与公开分享不复用上述 replay/live 状态。Markdown 直接请求 Agent Platform；WebClient HTML 导出并行请求 Platform Snapshot 与同源模板后用 Blob parts 组装，Desktop 分享则由常驻 Worker 请求 Snapshot 与 WebClient 模板。公开 `/share/` 由 Tunnel 直接返回已生成的 HTML 主文档。所有路径都不 attach active run，也不从当前 renderer timeline 重建快照。

当前对象历史与全局历史是两个独立入口。Copilot 顶栏、`/history` Composer 命令和全局快捷操作通过 Command Overlay 打开当前 Agent/Team 的历史抽屉：Agent 历史使用 `GET /api/chats?agentKey=...`，选择记录后派发 `agent:load-chat` 并在当前壳层内切换。全局聊天历史独立使用 `/history`，以无参数 `GET /api/chats` 获取全量摘要，并在前端按关键词、`updatedAt` 自然日范围和 Agent/Team 归属组合筛选；Agent-owned 记录只输出 `/agent/:agentKey?chatId=...`。Overview、Debug、Planning、Source、Artifact、Reference 的 URL 定位字段不会传给后端；它们只调用 `GET /api/chat?chatId=...`，再从同一 replay 投影按各自稳定 ID 定位。缺少或无效 ID 显示无效目标，不回退到其他节点或最新 Run。

Agent Copilot 使用相同的稳定对话身份规则：新对话收到稳定 `chatId` 后将 `/copilot/:agentKey` replace 为 `/copilot/:agentKey?chatId=<id>`，只收敛 URL，不重新加载正在消费的 live query。用户选择历史 chat 时先让既有 `agent:load-chat` 完成一次加载并同步 URL；点击新对话或切换 Agent 时立即清除旧 `chatId`。这些导航保留 `lang`、`theme`、`hostTheme`、`wsSource` 等宿主参数。Desktop 只被动镜像 URL，不读取 query 流 payload。

## 边界与非目标

- chat store 是后端事实源，前端只做读取、展示和缓存归并。
- replay 不应发起新的 run，也不应改变后端历史。
- 历史 `awaiting.ask` 不能单独恢复活动卡片；只有匹配的顶层 awaiting 才能锁定 Composer。
- worker 侧的对话聚合只服务前端导航，不改后端 team/agent 定义。

## 相关文件

- `../src/features/conversation/hooks/useConversationActions.ts`
- `../src/features/conversation/lib/conversationReplay.ts`
- `../src/features/conversation/hooks/useConversationEventHandler.ts`
- `../src/features/conversation/lib/conversationSession.ts`
- `../src/features/conversation/lib/chatTransition.ts`
- `../src/features/chats/lib/chatSummary.ts`
- `../src/features/chats/lib/chatSummaryLive.ts`
- `../src/features/runs/lib/runAgentIdentity.ts`
- `../src/features/chats/components/ChatItem.tsx`
