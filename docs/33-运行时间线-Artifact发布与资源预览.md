# Artifact发布与资源预览

## 当前状态
Artifact 是运行中后端通过 `artifact.publish` 事件发布的资源文件。前端把事件中的 artifacts 归一为 `PublishedArtifact`，显示在底部浮动 Artifact 面板和右侧 Overview 中，并复用 `AttachmentCard` 与统一的 Content Viewer。

## 核心职责
- 解析 `artifact.publish` 事件中的文件名、URL、mimeType、size、sha256。
- 维护 `state.artifacts`，按 artifactId upsert。
- 支持图片、PDF、HTML、文本、音频、视频直接预览，并把 Office 与未知二进制纳入仅下载 Viewer。
- 识别当前 Chat 的 `<relativePath>` ChatScope URL，并只在统一 API client 内加入当前 chatId，通过实际 `/api/resource?file=...` 鉴权 fetch 下载或读取资源。

## 核心流程
Timeline tool processor 识别 `artifact.publish`，调用 `normalizePublishedArtifacts` 生成命令，reducer 写入 artifacts。UI 层由 `ArtifactPanel`、`OverviewTab`、`AttachmentCard` 和 `ContentViewerPanel` 渲染列表、内容与下载动作。

Artifact、Reference 与普通附件先归一为 `ResourceViewerTarget`；Workspace File 归一为 `FileViewerTarget`。两者组成判别联合 `ViewerTarget`，分别携带资源 URL 或 Agent + Workspace path，不再经过 Attachment Preview DTO。Sidebar 以 `viewerTabs` 和 `activeViewerKey` 管理 Viewer，`ContentViewerPanel` 只消费 `ViewerTarget` 并按 `type` 选择 `/api/resource` 或 `/api/file` 数据链路。

Artifact 与 Reference 的 Standalone 独立 Viewer 统一使用 `/resource-viewer/:agentKey?chatId=...&file=...`，`file` 来自各自 `resourceTarget.url`，并复用同一 `ContentViewerPanel` 与路由注入的 ChatScope。没有可用资源 URL 时不输出独立链接；旧 `/artifact-view/:agentKey`、`/reference-view/:agentKey` 不保留兼容重定向。Workspace File 继续使用 `/file-viewer/:agentKey?path=...&line=...`，不请求 `/api/chat`，并保留行号定位。

Desktop 的展示所有权按资源类型分流：Main Chat 对 Artifact/Reference 先调用 v5 `openResource`，只提交 `profile + agentKey + chatId + resourceId + relativePath + title`。PNG、JPEG、WebP 由 Desktop 原生 WorkPanel 图片组件读取和编辑，WebClient 不创建 Resource Viewer WebView；宿主明确返回 `unsupported_native_type` 时才调用既有 `openItem` 打开 Resource Viewer。授权失败、资源缺失、身份或路径不匹配不得回退 Viewer。宿主没有 v5 `openResource` 的旧 Program Bundle 继续走旧 Viewer；Standalone 检测不到 Desktop bridge 时保持 Sidebar/独立 Resource Viewer。

Artifact、Reference、普通附件和回答 Markdown 中的文件链接都以 Viewer 为唯一左键入口。`artifacts/...`、`docs/...`、普通文件名等安全相对路径按当前 `chatId` 解释为 ChatScope 资源，打开 Resource Viewer；绝对 Workspace 路径仍打开 File Viewer。原链接、卡片、Viewer 根节点和 Viewer Tab 暴露右键下载 capability，Viewer 内不显示下载工具栏。左键打开失败、内容加载失败或文件类型不受支持时都不得自动触发下载。

图片、PDF、HTML、文本、音频和视频进入 Viewer 后直接读取并展示；Office、压缩包和其他未知二进制保留 `office` / `unsupported` 状态，不发起资源正文预览请求。Desktop 中的独立 Resource Viewer 与 Main Chat RightSidebar 都会在 `ContentViewerPanel` 内容区中央渲染“在 Finder/文件资源管理器中显示”和“用默认应用打开”，纯浏览器不渲染这组本地操作。按钮只向 Desktop 宿主提交请求 ID、动作、Chat 身份和 `artifacts/...` / `references/...` 相对路径，不提交本地绝对路径；WorkPanel 宿主还会用当前可信 descriptor 对请求身份做等值校验，Main Chat 宿主则用当前 owner Chat 校验。右键下载共用同一鉴权执行器，Workspace 文件先通过 `/api/file` 解析受限 `contentUrl`，ChatScope 资源继续使用原始逻辑 URL。

Artifact、普通附件和回答 Markdown 中的受保护图片、PDF、音视频先使用 Bearer/Cookie fetch 获得后端原始 MIME Blob，再创建短生命周期 object URL 交给媒体元素；卸载或 URL 变化时通过 effect cleanup revoke，同时用 AbortController 取消过期请求。HTML Resource Viewer 则通过同一鉴权 API 读取完整文本并以不带 `allow-same-origin` 的 sandbox `srcDoc` 展示，使 Desktop 可注入受限的元素批注消息桥而不放宽 iframe 隔离；HTML iframe 使用无内边距内容槽贴边展示，页面本身的 body margin 仍按原文保留。受 CORS 限制而无法读取文本的外部 HTML 仍可回退到原 sandbox URL 只读预览，但不声明批注 capability。新 `publishedArtifacts[].url` 形如 `artifacts/run_01/poster.png`。历史 `/api/resource?file=...` Markdown 被分类为非法，不再预览或下载；外部 HTTP(S) 图片继续直接使用外链，跨域下载不发送平台 Bearer，`data:` 与 `blob:` 原样展示。

回答 Markdown 兼容 `![说明](artifacts/run_01/demo.mp4)` 类历史输出：当图片语法的资源名以 `.m4v`、`.mov`、`.mp4`、`.mpeg`、`.mpg`、`.ogv` 或 `.webm` 结尾时，`MarkdownContent` 将其升级为带 controls 的鉴权 video 渲染；普通图片继续使用 `img`。若受保护资源的 Blob MIME 为空或 `application/octet-stream`，则按已识别的视频扩展名补齐 `video/*`，已有具体 MIME 不会被覆盖。该后缀判断仅用于兼容 Markdown 无标准视频语法的边界，Artifact 面板仍优先按自身的 MIME/扩展名规则识别预览类型。

Desktop 内容区右键语义只把资源名称、媒体类型和固定 open/download capability 返回宿主，不返回上述 object URL、资源 API URL 或鉴权信息。执行时重新定位当前 AttachmentCard、Markdown 链接或 Viewer，并复用左键的 `ViewerTarget` 构造或统一鉴权下载路径。WorkPanel 的 Artifact/Reference 外层 tab 另通过共享契约的版本化 `workPanel.resource.downloadCurrent` host action 请求下载；只有当前 Resource Viewer 注册处理器并复用同一 `downloadViewerTarget`，其他页面静默忽略，动作本身不携带 route、资源 URL、路径或凭据。

Desktop 原生图片稳定后，WebClient 的 preview-review 只保留 HTML Resource Viewer 分支。HTML 仍位于不带 `allow-same-origin` 的 sandbox iframe，通过只接受当前 frame source 与运行期 token 的窄 postMessage 桥同步编辑状态、选择元素和重绘 XPath 编号框。PNG、JPEG、WebP 的批注、临时 PNG 合成和 Composer staged attachment 均由 Desktop 原生图片编辑器负责；PDF、音视频、文本与不支持格式不声明批注能力。

## 边界与非目标
- Artifact 不负责用户上传；用户上传属于 Composer 附件链路。
- Resource URL 的权限、ticket 和文件存储由后端负责。
- 前端只校验 Viewer 必填字段、受支持的 URL 类型和路由编码；真实 `/api/resource` 链接、外部 URL 与 inline URL 不伪装为受保护 Resource Surface。ChatScope、Workspace、canonical path、symlink、Team Chat 与越界访问均由 Platform 的 `/api/resource` 最终判定，前端不按本地 Worker 元数据或聊天类型提前授权。
- 前端预览失败时只展示错误，不自动下载，也不尝试修复文件内容。

## 相关文件
- `../src/features/events/lib/processors/eventProcessorTool.ts`
- `../src/features/events/lib/processors/eventProcessorShared.ts`
- `../src/features/artifacts/components/ArtifactPanel.tsx`
- `../src/features/artifacts/components/AttachmentCard.tsx`
- `../src/features/viewers/lib/viewerTarget.ts`
- `../src/features/viewers/lib/viewerRuntime.ts`
- `../src/features/viewers/components/ContentViewerPanel.tsx`
- `../src/features/viewers/hooks/useDesktopHtmlPreviewReview.ts`
- `../src/shared/ui/MarkdownContent.tsx`
- `../src/shared/ui/useAuthenticatedResourceUrl.ts`
