# 统一 Document Surface

## 定位

Document Surface 把 Workspace File、Artifact 和 Reference 的打开逻辑统一成“来源身份 + 权威内容类型”。来源决定保存语义，类型决定编辑器或 Viewer；Main Chat、Markdown 文件链接、Project 和资源卡片不再分别选择 HTML/Text Viewer。

Standalone 全部由 WebClient 承载。Desktop 模式先用 canonical `openDocument` 提交语义来源；宿主只原生承载 HTML 和图片，其他类型仍使用本 Surface。

## 来源和提交

- Workspace File 只能使用当前不透明 revision 原位覆盖。
- Artifact 默认创建新 Artifact，用户可明确选择带 revision 覆盖原产物。
- Reference 永不覆盖，只能创建新 Artifact。

WebClient 不解析 revision，也不把临时扩展名分类当成最终事实。读取链路返回的 MIME、内容类型与 revision 会覆盖 provisional 分类；保存统一进入 Platform `document.commit`，`revision_conflict` 必须向用户显示重载或另存选择。

Resource metadata 缺少权威 kind header 时视为旧 Platform，不把“缺字段”解释成 binary，继续保留按语义文件名得到的 provisional 分类。权威 kind 为 binary 且语义文件名是已知文本扩展名时不进入编辑器，显示“文本编码不受支持”及下载入口；metadata 同时消费 `Content-Length` 展示准确大小。

## 内容能力

- Markdown、文本和代码使用 Monaco。Markdown 提供源码、净化预览和分屏，不执行 MDX 或内联 HTML 脚本。
- 文本批注以 revision、line/column range 和 selected-text hash 锚定。本地编辑期间由 Monaco decoration 跟随，外部 revision 变更后显式失效。
- PDF 使用本地 PDF.js 只读 Viewer，支持页码、缩放与搜索。
- Office 可预览时只读预览，否则显示元信息和显式操作。音视频使用媒体播放器。压缩包和未知二进制不读为文本，也不自动下载。
- Standalone HTML 提供源码和 sandbox 预览；Standalone 图片对 PNG/JPEG/WebP 提供基础 Canvas 编辑和区域批注，其他格式保持只读。

文档内容区不复用浏览器地址栏。文件名只显示在 WorkPanel Tab；Markdown 工具栏包含源码/预览/分屏、批注和保存，文本/代码只包含批注和保存。重新加载权威 revision 位于同一行的更多菜单，存在 dirty 修改时先确认丢弃。普通 Web、WebApp 与 loopback 实时网站仍保留刷新和地址栏。

Document Surface 向 Desktop 宿主只提交当前可信 WorkPanel item 的 dirty、busy、annotation count 与“交给智能体”动作。Standalone 直接写入当前 Composer；Desktop 由宿主校验 owner Chat 和 item 后追加 Composer 草稿，不覆盖也不自动发送。

## 路由、标题与兼容

`/file-viewer` 和 `/resource-viewer` 保留为历史入口，但内部都归一到 Document Surface。WorkPanel item 的稳定身份由来源决定，不因 Desktop native/WebClient renderer 变化而产生重复 Tab。

File descriptor 标题固定使用“显式 title > path basename > `file`”。basename 同时识别 POSIX、Windows 和 UNC 分隔符，但不对路径做 URL decode；标题仍通过既有空白、控制字符和长度清理。

Desktop bridge v6 的 `openDocument` 只有在明确返回 `unsupported_native_type` 时才允许回退 WebClient。授权、缺失、路径、身份和 revision 错误全部 fail closed。`DESKTOP_APP=true` 且 canonical contract 不兼容时阻断业务 Surface，不降级 Standalone。
