Knowledge Graph Explorer -- Single-Viewport Redesign Blueprint
Section 1: Problem Analysis
The current KnowledgeGraphPanel.tsx (1282 lines) renders everything in a single vertical stack:

Stats Card (6 Statistic cards in a grid) -- top of page
Workbench Card with Tabs (Q&A / Path / Navigation) -- middle
"Running State" + "Current View Perspective" panels -- below workbench
KnowledgeGraphExplorer (the canvas with its own filters/toolbar/detail panel) -- buried far down
Maintenance Card (sync, integrity, build history) -- bottom
The canvas lives inside KnowledgeGraphExplorer.tsx which itself has a horizontal split (Col 16 for canvas, Col 8 for node detail) -- but it is rendered INSIDE the scroll flow after ~1100px of content above it. The workbench (Q&A, Path, Navigation) is completely disconnected from the canvas spatially.

Key issues confirmed from code:

Canvas height is fixed at 560px (not viewport-filling)
window.scrollTo is used to scroll the graph into view on navigation commands
Stats use 6 separate Statistic cards each in their own Col
Filter bar in KnowledgeGraphExplorer is a Space wrap with 7 elements (search, type, community, limit, depth, zoom +/-, reset)
Node detail panel is always rendered (even when empty, showing an Empty placeholder)
Section 2: User Stories
US-1: Immediate Graph Exploration

AS A  knowledge graph analyst (知识图谱分析师)
I WANT TO  see the full graph visualization immediately when I open the page
SO THAT  I can begin exploring entity relationships without scrolling
ACCEPTANCE CRITERIA:

Graph canvas occupies ~65-70% of viewport width on load
Canvas fills available vertical space: calc(100vh - topBarHeight)
No scrolling required to reach the canvas from any starting point
Loading spinner appears inside the canvas area, not above it
US-2: Contextual Q&A Alongside the Graph

AS A  researcher exploring the knowledge graph
I WANT TO  ask questions in a sidebar panel adjacent to the graph
SO THAT  I can read answers while simultaneously viewing the visualization
ACCEPTANCE CRITERIA:

Q&A panel is in a left sidebar, visible side-by-side with the canvas
Matched nodes in answers are rendered as clickable tags
Clicking a node tag focuses the canvas on that node AND opens the right detail panel
Sidebar is collapsible to give the canvas more space when not needed
US-3: Path Finding with Visual Feedback

AS A  analyst investigating connections
I WANT TO  find and highlight paths between two entities without leaving the graph view
SO THAT  I can trace relationship chains visually in real time
ACCEPTANCE CRITERIA:

Path finding UI is a tab in the left sidebar (same level as Q&A)
Path result highlights edges and nodes on the canvas immediately
Path nodes are clickable in both the sidebar result and the canvas
Path tab auto-activates when a path command is triggered externally
US-4: On-Demand Node Detail

AS A  user clicking a node on the graph
I WANT TO  see its full detail in a contextual panel that slides in from the right
SO THAT  detail does not waste screen space when I am just browsing the graph
ACCEPTANCE CRITERIA:

Right panel is hidden by default (canvas takes full remaining width)
Panel slides in (width ~300px) when a node is selected
Panel slides out when selection is cleared (click canvas background)
Panel contains: label, type, degree, communities, neighbors, edges, articles
"Ask about this node" buttons remain accessible within the panel
US-5: Compact Overhead

AS A  power user
I WANT TO  have stats, filters, and maintenance tucked away
SO THAT  the graph and exploration tools dominate the viewport
ACCEPTANCE CRITERIA:

Top bar is a single 48px-tall strip with inline mini stats + search + core filters
Maintenance features (sync, integrity, build history) are in a Drawer accessed via a gear icon
Toolbar controls (zoom, reset, layout) float over the canvas as a small vertical pill
Section 3: ASCII Layout 1 -- Default State (Sidebar Open on Q&A, No Node Selected)
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ 顶部栏 (48px) ──────────────────────────────────────────────────────────────────────────────┐   │
│ │  知识图谱                                                                                     │   │
│ │                                                                                               │   │
│ │  节点 1,247  边 3,891  文章 456  覆盖 87.2%     ┌──────────────────────┐  ▼类型  ▼社区  ▼节点  │   │
│ │  ●已启用   快照 04-29 14:30                     │ 搜索实体名称...       │  筛选   筛选   160   │   │
│ │                                                 └──────────────────────┘               [齿轮] │   │
│ └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                     │
│ ┌──左侧栏 (320px)──┐ ┌── 图谱画布 (flex: 1, 约65-70%宽度) ─────────────────────────────────────┐   │
│ │                    │ │                                                                         │   │
│ │ ┌────┬────┬─────┐  │ │         ┌──浮动工具栏──┐                                               │   │
│ │ │问答│路径│ 导航 │  │ │         │  [+]         │                                               │   │
│ │ └────┴────┴─────┘  │ │         │  [-]         │                   *                           │   │
│ │ ─ ─ ─ ─ ─ ─ ─ ─   │ │         │  [适]        │             *          *                      │   │
│ │                    │ │         │  [复]        │        *         *        *                    │   │
│ │ ▼ 查询模式         │ │         │  [色]        │           *                                    │   │
│ │ ┌────────────────┐ │ │         └──────────────┘      *       *      *                         │   │
│ │ │ Hybrid     ▼   │ │ │                                  *       *                              │   │
│ │ └────────────────┘ │ │                           *         *                                   │   │
│ │                    │ │                      *         *       *      *                          │   │
│ │ ┌────────────────┐ │ │                          *                                              │   │
│ │ │                │ │ │                *    *        *    *       *                               │   │
│ │ │  请输入你的    │ │ │                       *                *                                 │   │
│ │ │  问题...      │ │ │                  *       *      *                                        │   │
│ │ │               │ │ │               *              *                                           │   │
│ │ │               │ │ │                     *   *        *                                        │   │
│ │ └────────────────┘ │ │                          *                                              │   │
│ │                    │ │                  *                                                       │   │
│ │ ╔════════════════╗ │ │                        D3 力导向图                                       │   │
│ │ ║   开始问答     ║ │ │                      (Force-directed)                                   │   │
│ │ ╚════════════════╝ │ │                                                                         │   │
│ │                    │ │                                                                         │   │
│ │ ┌────────────────┐ │ │                                                                         │   │
│ │ │  (回答区域)    │ │ │                                                                         │   │
│ │ │                │ │ │                                                                         │   │
│ │ │  等待问答...   │ │ │                                                                         │   │
│ │ │                │ │ │                                                                         │   │
│ │ │  输入问题后，  │ │ │                                                                         │   │
│ │ │  这里会显示    │ │ │                                                                         │   │
│ │ │  Markdown回答  │ │ │                                                                         │   │
│ │ │  和命中节点。  │ │ │                                                                         │   │
│ │ │                │ │ │ ┌─────────────────────────────────────────────────────────────────────┐ │   │
│ │ └────────────────┘ │ │ │ 缩放 100%  节点 160/1247  边 891  力导画布  ●全局视图              │ │   │
│ │                    │ │ └─────────────────────────────────────────────────────────────────────┘ │   │
│ │  [◀ 收起侧栏]      │ │                                                                         │   │
│ └────────────────────┘ └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
Layout specification:

顶部栏 (Top Bar):
  Height: 48px fixed
  Layout: flex, space-between
  Left:   Logo/Title "知识图谱"
  Center: Mini stats (inline Tags: 节点 1,247 | 边 3,891 | 文章 456 | 覆盖 87.2%)
          Status badge (●已启用)
          Snapshot time (快照 04-29 14:30)
  Right:  Search input (width: 240px)
          Node type select (compact, 120px)
          Community select (compact, 140px)
          Node limit select (compact, 90px)
          Settings gear button -> opens maintenance Drawer
左侧栏 (Left Sidebar):
  Width: 320px (collapsible to 0)
  Height: calc(100vh - 48px)
  overflow-y: auto (internal scroll)
  Tabs: 问答 | 路径 | 导航
  Bottom: collapse toggle button [◀ 收起侧栏]
图谱画布 (Graph Canvas):
  Width: flex: 1 (fills remaining space)
  Height: calc(100vh - 48px)
  Contains: D3 canvas (full area)
  Floating toolbar: positioned absolute, top-right or top-left
  Status bar: positioned absolute, bottom, semi-transparent
浮动工具栏 (Floating Toolbar):
  Position: absolute, top: 16px, right: 16px (or left: 16px)
  Layout: vertical pill, 40px wide
  Buttons: [+] zoom in, [-] zoom out, [适] fit-to-view, [复] reset, [色] color legend
  Style: frosted glass background, rounded-xl, shadow
画布状态栏 (Canvas Status Bar):
  Position: absolute, bottom: 0, full width
  Height: 32px
  Content: zoom %, visible node count, edge count, layout mode, current view label
  Style: semi-transparent background
Section 4: ASCII Layout 2 -- Node Selected State (Right Detail Panel Visible)
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ 顶部栏 (48px) ──────────────────────────────────────────────────────────────────────────────┐   │
│ │  知识图谱                                                                                     │   │
│ │                                                                                               │   │
│ │  节点 1,247  边 3,891  文章 456  覆盖 87.2%     ┌──────────────────────┐  ▼类型  ▼社区  ▼节点  │   │
│ │  ●已启用   快照 04-29 14:30                     │ OpenAI              │  筛选   筛选   160   │   │
│ │                                                 └──────────────────────┘               [齿轮] │   │
│ └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                     │
│ ┌──左侧栏 (320px)──┐ ┌── 图谱画布 (flex: 1) ─────────────────────┐ ┌── 节点详情 (320px) ──────┐   │
│ │                    │ │                                           │ │                          │   │
│ │ ┌────┬────┬─────┐  │ │    ┌──浮动工具栏──┐                      │ │  ╳ 关闭                   │   │
│ │ │问答│路径│ 导航 │  │ │    │  [+]         │                      │ │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │   │
│ │ └────┴────┴─────┘  │ │    │  [-]         │          *           │ │                          │   │
│ │ ─ ─ ─ ─ ─ ─ ─ ─   │ │    │  [适]        │     *      ◉ ←选中   │ │  OpenAI                  │   │
│ │                    │ │    │  [复]        │       *  / | \  *     │ │  node_key: openai        │   │
│ │ ▼ 查询模式         │ │    │  [色]        │      * /  |  \ *     │ │                          │   │
│ │ ┌────────────────┐ │ │    └──────────────┘     *  * *  *        │ │  ┌─────┐┌──────┐┌─────┐  │   │
│ │ │ Graph      ▼   │ │ │                               *          │ │  │组织 ││度数 8││文章 │  │   │
│ │ └────────────────┘ │ │                          *                │ │  └─────┘└──────┘└12───┘  │   │
│ │                    │ │                     *      *              │ │                          │   │
│ │ ┌────────────────┐ │ │                        *                  │ │ ╔══════════╗ ┌────────┐  │   │
│ │ │ OpenAI最近有   │ │ │                   *                       │ │ ║Graph问答 ║ │Hybrid  │  │   │
│ │ │ 哪些重要的合   │ │ │                                           │ │ ╚══════════╝ └────────┘  │   │
│ │ │ 作关系变化？   │ │ │                                           │ │                          │   │
│ │ └────────────────┘ │ │                                           │ │ ┌─ 1跳邻域 ─┐ ┌─ 2跳 ─┐ │   │
│ │                    │ │                                           │ │ │   聚焦     │ │ 聚焦  │ │   │
│ │ ╔════════════════╗ │ │                                           │ │ └───────────┘ └──────┘ │   │
│ │ ║   开始问答     ║ │ │                                           │ │                          │   │
│ │ ╚════════════════╝ │ │                                           │ │ ── 所在社区 ──────────── │   │
│ │                    │ │                                           │ │ [AI与大模型]             │   │
│ │ ┌────────────────┐ │ │                                           │ │                          │   │
│ │ │  回答结果      │ │ │                                           │ │ ── 邻居节点 ──────────── │   │
│ │ │ (Hybrid)       │ │ │                                           │ │ Microsoft    [聚焦]      │   │
│ │ │                │ │ │                                           │ │   组织 · 度数 6          │   │
│ │ │ OpenAI近期与   │ │ │                                           │ │ GPT-4o       [聚焦]      │   │
│ │ │ Microsoft的..  │ │ │                                           │ │   技术 · 度数 4          │   │
│ │ │                │ │ │                                           │ │ Sam Altman   [聚焦]      │   │
│ │ │ 命中节点：     │ │ │                                           │ │   人物 · 度数 3          │   │
│ │ │ [OpenAI]       │ │ │                                           │ │                          │   │
│ │ │ [Microsoft]    │ │ │                                           │ │ ── 关系 ────────────────  │   │
│ │ │ [GPT-4o]       │ │ │                                           │ │ openai --投资--> msft    │   │
│ │ │                │ │ │                                           │ │ openai --开发--> gpt4o   │   │
│ │ │ 命中社区：     │ │ │                                           │ │                          │   │
│ │ │ [AI与大模型]   │ │ │                                           │ │ ── 相关文章 ────────────  │   │
│ │ │                │ │ │                                           │ │ OpenAI发布新... [定位]   │   │
│ │ │ 相关文章：     │ │ │                                           │ │   TechCrunch · 关系 5    │   │
│ │ │ OpenAI发布..   │ │ │ ┌─ 状态栏 ──────────────────────────────┐ │ │ Microsoft扩展..  [定位]   │   │
│ │ │    [图谱定位]  │ │ │ │ 缩放 130%  节点 12  ●节点聚焦中       │ │ │   Reuters · 关系 3       │   │
│ │ └────────────────┘ │ │ └───────────────────────────────────────┘ │ │                          │   │
│ │  [◀ 收起侧栏]      │ │                                           │ │                          │   │
│ └────────────────────┘ └───────────────────────────────────────────┘ └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
Layout specification for 3-column state:

三列布局 (Three Column Layout):
  Left sidebar:   320px (collapsible)
  Center canvas:  flex: 1 (shrinks when right panel opens)
  Right panel:    320px (conditional, slides in with transition)
  Transition: right panel uses CSS transform: translateX(320px) -> translateX(0)
              canvas flex naturally shrinks, no jump
              Duration: 250ms ease-out
右侧节点详情面板 (Right Node Detail Panel):
  Width: 320px
  Height: calc(100vh - 48px)
  overflow-y: auto
  Trigger: selectedNodeKey !== undefined
  Close: X button or click canvas background
  Sections (top to bottom):
  1. Header: label (large), node_key (secondary), close button
  2. Meta tags: node_type tag, degree tag, article_count tag
  3. Action buttons: Graph问答, Hybrid问答, 1跳邻域, 2跳邻域
  4. Communities: clickable purple tags
  5. Neighbors list: label + type + [聚焦] button
  6. Edges list: source --relation--> target
  7. Related articles: title (link) + source + [图谱定位]
Section 5: ASCII Layout -- Sidebar Collapsed State
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ 顶部栏 (48px) ──────────────────────────────────────────────────────────────────────────────┐   │
│ │  知识图谱    节点 1,247  边 3,891  文章 456  覆盖 87.2%  ┌─────────────────┐ ▼类型 ▼社区 [齿轮]│   │
│ └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                     │
│ ┌┐ ┌── 图谱画布 (占满剩余宽度) ───────────────────────────────────────────────────────────────┐   │
│ ││ │                                                                                           │   │
│ │▶│ │         ┌──浮动工具栏──┐                                                                 │   │
│ ││ │         │  [+]         │                          *                                       │   │
│ │展│ │         │  [-]         │                    *          *                                  │   │
│ │开│ │         │  [适]        │               *         *        *                              │   │
│ │侧│ │         │  [复]        │                  *                                              │   │
│ │栏│ │         │  [色]        │             *       *      *                                    │   │
│ ││ │         └──────────────┘                *       *                                         │   │
│ ││ │                                   *         *                                              │   │
│ ││ │                              *         *       *      *                                    │   │
│ ││ │                                  *                                                         │   │
│ ││ │                        *    *        *    *       *                                         │   │
│ ││ │                               *                *                                           │   │
│ ││ │                          *       *      *                                                  │   │
│ ││ │                       *              *                                                     │   │
│ ││ │                             *   *        *                                                  │   │
│ ││ │                                  *                                                         │   │
│ ││ │                              D3 力导向图 -- 最大化模式                                      │   │
│ ││ │                                                                                           │   │
│ ││ │                                                                                           │   │
│ ││ │ ┌─ 状态栏 ──────────────────────────────────────────────────────────────────────────────┐ │   │
│ ││ │ │ 缩放 100%  节点 160/1247  边 891  力导画布  ●全局视图                                 │ │   │
│ └┘ │ └───────────────────────────────────────────────────────────────────────────────────────┘ │   │
│    └───────────────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
Collapsed sidebar: 36px wide vertical strip
  Contains: [▶] expand button + vertical text "展开侧栏"
  Canvas expands to fill the freed space
Section 6: ASCII Layout -- Maintenance Drawer (Triggered by Gear Button)
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  (Main UI remains visible but dimmed behind the drawer overlay)                         │
│                                                                                         │
│                                              ┌── 运维管理 (Drawer, 520px) ─────────────┐│
│                                              │                                         ││
│                                              │  ╳ 关闭                                  ││
│                                              │ ────────────────────────────────────────  ││
│                                              │                                         ││
│                                              │  ── 同步与修复 ───────────────────────── ││
│                                              │                                         ││
│                                              │  运行模式  ┌─────────────┐               ││
│                                              │           │ 自动     ▼  │               ││
│                                              │           └─────────────┘               ││
│                                              │  文章上限  ┌─────────────┐               ││
│                                              │           │ 最多100篇 ▼ │               ││
│                                              │           └─────────────┘               ││
│                                              │                                         ││
│                                              │  ╔══════════╗  ┌──────────┐  ┌────────┐ ││
│                                              │  ║ 增量同步  ║  │ 诊断修复 │  │ 刷新   │ ││
│                                              │  ╚══════════╝  └──────────┘  └────────┘ ││
│                                              │                                         ││
│                                              │  ┌────────────────────────────────────┐ ││
│                                              │  │ ✓ 图谱完整性正常                     │ ││
│                                              │  │   未发现需要继续处理的问题             │ ││
│                                              │  └────────────────────────────────────┘ ││
│                                              │                                         ││
│                                              │  ── 构建历史 ───────────────────────────  ││
│                                              │                                         ││
│                                              │  a1b2c3d4e5f6  [已完成]  04-29 12:30    ││
│                                              │    dashboard · auto · 处理 45/50         ││
│                                              │    跳过 5 · 失败 0 · 节点 120 · 边 340   ││
│                                              │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ││
│                                              │  f7g8h9i0j1k2  [已完成]  04-28 18:15    ││
│                                              │    scheduler · agent · 处理 100/100      ││
│                                              │    跳过 0 · 失败 2 · 节点 280 · 边 720   ││
│                                              │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ││
│                                              │  ...                                    ││
│                                              │                                         ││
│                                              │  ── 运行状态 ───────────────────────────  ││
│                                              │                                         ││
│                                              │  ●已启用  自动同步 开启  查询深度 2       ││
│                                              │  运行模式 自动  快照更新 04-29 14:30     ││
│                                              │                                         ││
│                                              └─────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────────────┘
Section 7: Left Sidebar -- Tab Detail Layouts
Q&A Tab (问答):

┌─── 问答 ────────────────┐
│                          │
│  查询模式                │
│  ┌────────────────────┐  │
│  │ Hybrid          ▼  │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │                    │  │
│  │  请输入你的问题..  │  │
│  │                    │  │
│  │                    │  │
│  └────────────────────┘  │
│                          │
│  ╔════════════════════╗  │
│  ║     开始问答       ║  │
│  ╚════════════════════╝  │
│                          │
│  ┌── 回答结果 ────────┐  │
│  │                    │  │
│  │  (Markdown渲染)    │  │
│  │                    │  │
│  │  ## 关键发现       │  │
│  │  1. ...            │  │
│  │  2. ...            │  │
│  │                    │  │
│  │  ── 命中节点 ──    │  │
│  │  [OpenAI/组织]     │  │  <-- clickable tags
│  │  [GPT-4o/技术]     │  │      call focusNode()
│  │  [Microsoft/组织]  │  │
│  │                    │  │
│  │  ── 命中社区 ──    │  │
│  │  [AI与大模型]      │  │  <-- opens community drawer
│  │                    │  │
│  │  ── 相关文章 ──    │  │
│  │  OpenAI发布新..    │  │
│  │  TechCrunch [定位] │  │  <-- focusArticle()
│  │                    │  │
│  │  上下文: 节点 24   │  │
│  │          边 68     │  │
│  └────────────────────┘  │
│                          │
└──────────────────────────┘
Path Tab (路径):

┌─── 路径 ────────────────┐
│                          │
│  ┌────────────────────┐  │
│  │ 搜索节点...        │  │
│  └────────────────────┘  │
│                          │
│  起点                    │
│  ┌────────────────────┐  │
│  │ ▼ 选择起点节点     │  │
│  └────────────────────┘  │
│                          │
│  终点                    │
│  ┌────────────────────┐  │
│  │ ▼ 选择终点节点     │  │
│  └────────────────────┘  │
│                          │
│  ╔════════════════════╗  │
│  ║   查询最短路径     ║  │
│  ╚════════════════════╝  │
│                          │
│  ┌── 路径结果 ────────┐  │
│  │                    │  │
│  │  路径长度：3       │  │
│  │                    │  │
│  │  OpenAI            │  │
│  │    │ --投资-->      │  │
│  │  Microsoft         │  │
│  │    │ --合作-->      │  │
│  │  Azure             │  │
│  │    │ --部署-->      │  │
│  │  GPT-4o            │  │
│  │                    │  │
│  │  路径节点:         │  │
│  │  [OpenAI]          │  │
│  │  [Microsoft]       │  │
│  │  [Azure]           │  │
│  │  [GPT-4o]          │  │
│  │                    │  │
│  │  [在图谱中重新高亮] │  │
│  └────────────────────┘  │
│                          │
└──────────────────────────┘
Navigation Tab (导航):

┌─── 导航 ────────────────┐
│                          │
│  ┌────────────────────┐  │
│  │ 搜索实体名称...    │  │
│  └────────────────────┘  │
│                          │
│  ┌────────┬────────┐     │
│  │实体入口│社区入口│     │
│  └────────┴────────┘     │
│                          │
│  (实体入口 active)       │
│                          │
│  ┌────────────────────┐  │
│  │ OpenAI             │  │
│  │ openai · 组织 · 8  │  │
│  │              [定位] │  │
│  ├────────────────────┤  │
│  │ Google DeepMind    │  │
│  │ deepmind · 组织 · 6│  │
│  │              [定位] │  │
│  ├────────────────────┤  │
│  │ GPT-4o             │  │
│  │ gpt4o · 技术 · 4   │  │
│  │              [定位] │  │
│  ├────────────────────┤  │
│  │ ...                │  │
│  └────────────────────┘  │
│                          │
│  (社区入口)              │
│                          │
│  ┌────────────────────┐  │
│  │ AI与大模型          │  │
│  │ 节点 42 边 120 文28 │  │
│  │ [OpenAI] [GPT-4o]  │  │
│  │          [打开社区] │  │
│  ├────────────────────┤  │
│  │ 芯片与硬件          │  │
│  │ 节点 28 边 76 文15  │  │
│  │ [NVIDIA] [AMD]     │  │
│  │          [打开社区] │  │
│  └────────────────────┘  │
│                          │
└──────────────────────────┘
Section 8: Floating Toolbar Detail
┌────────────────────┐
│ Floating Toolbar   │
│ (40px wide pill)   │
│                    │
│  ┌──┐              │
│  │+ │  放大 (zoom in)
│  └──┘              │
│  ┌──┐              │
│  │- │  缩小 (zoom out)
│  └──┘              │
│  ┌──┐              │
│  │适│  适应画布 (fit to view / resetViewport)
│  └──┘              │
│  ┌──┐              │
│  │全│  恢复全图 (clearExplorerState)
│  └──┘              │
│  ┌──┐              │
│  │色│  图例/着色模式 (toggle legend overlay)
│  └──┘              │
│  ─────             │
│  ┌──┐              │
│  │深│  邻域深度 (cycle: 0 -> 1 -> 2 -> 0)
│  └──┘              │
│                    │
│  Style:            │
│  - border-radius: 24px
│  - background: rgba(bg, 0.85)
│  - backdrop-filter: blur(12px)
│  - box-shadow: 0 4px 24px rgba(0,0,0,0.12)
│  - padding: 8px 4px
│  - gap: 4px between buttons
└────────────────────┘
Section 9: Interaction Flow -- State Diagram
STATE: Page Load
┌───────────────────────┐
│  Loading              │
│  ◐ Fetching stats...  │──── API: getKnowledgeGraphStats ────>
└───────────────────────┘                                      │
                                                               ▼
STATE: Default View                                    STATE: Graph Disabled
┌───────────────────────┐                              ┌────────────────────┐
│  Sidebar: Q&A tab     │                              │  ⚠ 知识图谱未启用  │
│  Canvas: full graph   │                              │  请在设置中启用    │
│  Right: hidden        │                              └────────────────────┘
│  Toolbar: floating    │
└───────┬───────────────┘
        │
        ├──── User types question in sidebar ────>
        │     STATE: Q&A Active
        │     ┌───────────────────────┐
        │     │  Sidebar: streaming   │
        │     │  answer rendering...  │ ←── SSE chunks from queryKnowledgeGraphStream
        │     │  Canvas: unchanged    │
        │     └──────┬────────────────┘
        │            │
        │            ├── User clicks [OpenAI] node tag in answer ──>
        │            │   ACTION: focusNode('openai')
        │            │   STATE: Node Focused + Detail Open
        │            │   ┌───────────────────────────────────┐
        │            │   │  Canvas: zooms to openai node     │
        │            │   │  Right panel: slides in (320px)   │
        │            │   │  Shows: type, degree, neighbors   │
        │            │   └──────┬────────────────────────────┘
        │            │          │
        │            │          ├── User clicks neighbor "Microsoft" in detail panel ──>
        │            │          │   ACTION: handleNodeClick('microsoft')
        │            │          │   STATE: Node Focus Shifts
        │            │          │   ┌───────────────────────────────────┐
        │            │          │   │  Canvas: re-centers on microsoft │
        │            │          │   │  Right panel: updates content    │
        │            │          │   │  Previous node dims, new glows   │
        │            │          │   └───────────────────────────────────┘
        │            │          │
        │            │          ├── User clicks "Graph问答" in detail panel ──>
        │            │          │   ACTION: handleAskAboutNode('graph')
        │            │          │   Opens AI conversation modal with pre-filled question
        │            │          │
        │            │          ├── User clicks [AI与大模型] community tag ──>
        │            │          │   ACTION: focusCommunity(communityId)
        │            │          │   Opens KnowledgeGraphCommunityDrawer
        │            │          │
        │            │          └── User clicks canvas background ──>
        │            │              ACTION: setSelectedNodeKey(undefined)
        │            │              STATE: Detail panel slides out, canvas expands
        │            │
        │            └── User clicks [AI与大模型] community tag in answer ──>
        │                ACTION: openCommunityDrawer(community)
        │                Opens Drawer overlay with community detail
        │
        ├──── User switches to Path tab ────>
        │     STATE: Path Finding
        │     ┌───────────────────────┐
        │     │  Sidebar: path UI     │
        │     │  Source: (select)     │
        │     │  Target: (select)    │
        │     └──────┬────────────────┘
        │            │
        │            └── User selects source + target, clicks 查询最短路径 ──>
        │                ACTION: pathMutation.mutate()
        │                STATE: Path Highlighted
        │                ┌───────────────────────────────────┐
        │                │  Canvas: path edges glow orange   │
        │                │  Path nodes enlarged + colored    │
        │                │  Sidebar: shows path chain        │
        │                │  Status bar: ●路径高亮中           │
        │                └───────────────────────────────────┘
        │
        ├──── User switches to Navigation tab ────>
        │     STATE: Entity Browsing
        │     ┌───────────────────────┐
        │     │  Sidebar: node list   │
        │     │  or community list    │
        │     └──────┬────────────────┘
        │            │
        │            └── User clicks node in list ──>
        │                ACTION: focusNode(nodeKey)
        │                STATE: Same as "Node Focused + Detail Open" above
        │
        ├──── User clicks [齿轮] gear in top bar ────>
        │     STATE: Maintenance Drawer
        │     ┌───────────────────────┐
        │     │  Drawer slides in     │
        │     │  from right (520px)   │
        │     │  Sync, repair, history│
        │     └───────────────────────┘
        │
        ├──── User clicks [◀ 收起侧栏] ────>
        │     STATE: Sidebar Collapsed
        │     ┌───────────────────────┐
        │     │  Sidebar: 36px strip  │
        │     │  Canvas: expanded     │
        │     └───────────────────────┘
        │
        └──── User clicks floating toolbar buttons ────>
              [+] → zoom in (scale + 0.12)
              [-] → zoom out (scale - 0.12)
              [适] → resetViewport()
              [全] → clearExplorerState()
              [色] → toggle color legend overlay
Section 10: Step-by-Step Core Exploration User Journey
Journey 1: Open Page and Ask a Question

Entry Point: User navigates to the Knowledge Graph tab from the main navigation
Initial View: User sees the full graph visualization immediately -- the D3 force-directed graph dominates the viewport center (~65% width). The left sidebar is open on the "问答" (Q&A) tab. The top bar shows inline stats: "节点 1,247 边 3,891 文章 456 覆盖 87.2%". No scrolling is needed.
Orient: User scans the floating toolbar (top-right of canvas) and the status bar at the bottom of the canvas ("缩放 100% 节点 160/1247 全局视图")
Ask Question: User types "OpenAI最近有哪些重要的合作关系变化？" in the TextArea in the left sidebar
Select Mode: User confirms query mode is "Hybrid" (default) in the dropdown above the TextArea
Submit: User clicks "开始问答" button
System Streams: The answer area below the button begins rendering Markdown content in real-time via SSE. The sidebar scrolls internally to show the growing answer.
Answer Complete: User sees the full Markdown answer, followed by "命中节点" section with clickable tags: [OpenAI/组织] [Microsoft/组织] [GPT-4o/技术], "命中社区" with [AI与大模型], and "相关文章" list with "图谱定位" links.
Journey 2: Click a Node Tag to Explore

Click Node Tag: User clicks the [OpenAI/组织] tag in the Q&A answer
Graph Animates: The canvas smoothly zooms and pans to center on the "OpenAI" node. The node enlarges and glows. Its neighbors dim slightly. Duration: ~400ms transition.
Right Panel Opens: The node detail panel slides in from the right edge (320px wide, 250ms ease-out). The canvas width shrinks proportionally. Panel shows: "OpenAI", node_key: openai, tags: [组织] [度数 8] [文章 12]
Scan Detail: User sees action buttons (Graph问答, Hybrid问答, 1跳邻域, 2跳邻域), community tags, neighbor list, edge list, and related articles -- all in a single scrollable panel
Status Bar Updates: Canvas status bar now shows "缩放 130% 节点 12 节点聚焦中"
Journey 3: Navigate Through Neighbors

Click Neighbor: User sees "Microsoft" in the neighbor list with a [聚焦] button and clicks it
Graph Re-centers: Canvas smoothly moves to center on "Microsoft". The selection ring transfers from "OpenAI" to "Microsoft". The right panel content updates with Microsoft's detail.
Continue: User can repeat this pattern to traverse the graph -- each neighbor click updates both the canvas focus and the detail panel.
Journey 4: Find a Path

Switch Tab: User clicks the "路径" tab in the left sidebar
Search Nodes: User types "openai" in the search input, selects "OpenAI (openai)" as the source
Select Target: User types "nvidia" and selects "NVIDIA (nvidia)" as the target
Submit Path: User clicks "查询最短路径"
Path Highlighted: The canvas highlights the discovered path: OpenAI --> Microsoft --> Azure --> NVIDIA. Path edges glow orange, path nodes enlarge. The sidebar shows the path chain with clickable node tags.
Status Bar: Shows "●路径高亮中"
Explore Path Node: User clicks [Azure] tag in the path result, which triggers focusNode and opens the right detail panel for Azure
Journey 5: Access Maintenance (Admin)

Open Drawer: User clicks the [齿轮] gear icon in the top-right of the top bar
Drawer Opens: A 520px drawer slides in from the right with: sync controls (mode selector, article limit), action buttons (增量同步, 诊断修复, 刷新), integrity status alert, and build history list
Run Sync: User clicks "增量同步", sees loading state, gets success toast
Close Drawer: User clicks X or clicks outside the drawer. The main graph view is fully restored.
Section 11: Component Architecture Mapping
Current Component          -->  New Component / Placement
──────────────────────────────────────────────────────────────────
KnowledgeGraphPanel.tsx         KnowledgeGraphPage.tsx (new top-level)
  Stats cards (6x)         -->  TopBar inline mini-stats (Tags)
  Workbench Tabs           -->  LeftSidebar (tabs: Q&A / Path / Navigate)
  Running State panel      -->  Maintenance Drawer (low-frequency section)
  Current View panel       -->  Canvas StatusBar (bottom strip)
  KnowledgeGraphExplorer   -->  Promoted to main flex child
KnowledgeGraphExplorer.tsx      KnowledgeGraphExplorer.tsx (refactored)
  Filter Space wrap        -->  TopBar inline filters (search, type, community, limit)
  Canvas Col(16)           -->  Canvas flex:1 (dominant element)
  NodeDetail Col(8)        -->  RightDetailPanel (conditional slide-in, 320px)
  Toolbar buttons          -->  FloatingToolbar (absolute positioned pill)
  Status Tags              -->  CanvasStatusBar (absolute positioned bottom strip)
KnowledgeGraphCommunityDrawer   (unchanged, overlay Drawer)
New Components:
  TopBar.tsx               -->  48px header with stats + search + filters + gear
  LeftSidebar.tsx          -->  320px collapsible sidebar with Q&A / Path / Navigate
  FloatingToolbar.tsx      -->  Vertical pill with zoom/reset/legend controls
  CanvasStatusBar.tsx      -->  Semi-transparent bottom strip
  RightDetailPanel.tsx     -->  Slide-in node detail (extracted from NodeDetailCard)
  MaintenanceDrawer.tsx    -->  Ant Design Drawer with sync + integrity + build history
Section 12: Responsive and Edge Case Handling
Breakpoint Behavior:
  >= 1440px (xl):  Full 3-column layout as designed
  1024-1439px (lg): Left sidebar narrows to 280px, right panel to 280px
  768-1023px (md):  Left sidebar becomes a floating drawer (like mobile)
                    Right panel becomes a bottom sheet or Drawer
  < 768px (sm):     Single-column: canvas full-screen
                    Sidebar as bottom sheet (swipe up)
                    Detail as Drawer from right
Edge Cases:
  EC-1: Graph disabled (stats?.enabled === false)
  ┌─────────────────────────────────────────┐
  │  Canvas area shows:                     │
  │  ┌───────────────────────────────────┐  │
  │  │                                   │  │
  │  │    ⚠ 知识图谱当前已关闭           │  │
  │  │    请先在系统设置中启用知识图谱    │  │
  │  │                                   │  │
  │  │    ╔══════════════════╗            │  │
  │  │    ║  前往设置页面    ║            │  │
  │  │    ╚══════════════════╝            │  │
  │  │                                   │  │
  │  └───────────────────────────────────┘  │
  │  Sidebar tabs disabled (greyed out)     │
  │  Top bar stats show 0 values            │
  └─────────────────────────────────────────┘
  EC-2: Empty graph (nodes.length === 0 after filter)
  ┌───────────────────────────────────┐
  │  Canvas area shows:               │
  │  ┌───────────────────────────┐    │
  │  │                           │    │
  │  │  当前筛选条件下没有       │    │
  │  │  可展示的节点             │    │
  │  │                           │    │
  │  │  [恢复全图]               │    │
  │  │                           │    │
  │  └───────────────────────────┘    │
  └───────────────────────────────────┘
  EC-3: API loading states
  - Stats loading: top bar shows skeleton placeholders for numbers
  - Graph loading: canvas shows centered Spin with "加载图谱..."
  - Node detail loading: right panel shows Spin
  - Q&A streaming: sidebar shows typing indicator with growing Markdown
  EC-4: Path not found
  ┌── Path result area ────────────┐
  │  ┌──────────────────────────┐  │
  │  │  未找到路径               │  │
  │  │                          │  │
  │  │  两个实体之间可能没有    │  │
  │  │  直接或间接的关系连接    │  │
  │  └──────────────────────────┘  │
  └────────────────────────────────┘
  EC-5: Not authenticated (maintenance)
  - Gear button still visible but clicking shows login prompt
  - Sync/repair buttons disabled with tooltip "需要登录"
  EC-6: Node deleted while detail panel open
  - If selectedNodeKey not found in new snapshot:
    setSelectedNodeKey(undefined) -> panel slides out
    (Already handled in current code via useEffect)
Section 13: CSS Layout Skeleton
/* Page-level layout */
.kg-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.kg-topbar {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  gap: 16px;
}
.kg-body {
  display: flex;
  flex: 1;
  overflow: hidden;               /* no page-level scroll */
  height: calc(100vh - 48px);
}
.kg-sidebar {
  width: 320px;                   /* or 36px when collapsed */
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 250ms ease;
}
.kg-sidebar--collapsed {
  width: 36px;
}
.kg-sidebar__tabs {
  flex-shrink: 0;
}
.kg-sidebar__content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.kg-canvas-area {
  flex: 1;
  position: relative;             /* for floating toolbar + status bar */
  overflow: hidden;
}
.kg-canvas-area canvas {
  width: 100%;
  height: 100%;
}
.kg-floating-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;                    /* or left: 16px */
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 4px;
  border-radius: 24px;
  background: rgba(var(--bg-rgb), 0.85);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  z-index: 10;
}
.kg-status-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: rgba(var(--bg-rgb), 0.72);
  backdrop-filter: blur(8px);
  font-size: 12px;
  z-index: 10;
}
.kg-detail-panel {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  overflow-y: auto;
  transform: translateX(320px);
  transition: transform 250ms ease-out;
}
.kg-detail-panel--open {
  transform: translateX(0);
}
Section 14: Key Design Decisions and Rationale
Decision	Rationale
Sidebar for Q&A instead of above-canvas card	Q&A answers can be long; a sidebar with internal scroll keeps the canvas visible while reading
Right panel conditional (slide-in)	Node detail is only needed after clicking a node; hiding it by default gives the canvas ~320px more width
Stats in top bar as inline Tags	6 Statistic cards consumed ~200px of vertical space; compact Tags convey the same information in 48px
Maintenance in Drawer	Sync/repair/build history are admin-only, low-frequency actions. A Drawer keeps them accessible but out of the exploration flow
Floating toolbar over canvas	Canvas controls (zoom, reset) need to be near the canvas. A floating pill avoids cluttering the top bar and stays contextually correct during pan/zoom
Status bar at canvas bottom	Viewport info (zoom %, node count, current view state) belongs to the canvas context, not the page header
100vh - 48px height model	Eliminates page-level scrolling entirely. Each panel (sidebar, canvas, detail) scrolls independently within its own area
320px sidebar width	Enough for Q&A text area, path selectors, and navigation lists without feeling cramped. Matches Ant Design Sider common width
DISPLAY INSTRUCTIONS FOR OUTER AGENT
Outer Agent: You MUST present this UI blueprint using the following format:

Preserve ALL ASCII graphics exactly as designed - Do not convert to text descriptions
Use monospace formatting for all ASCII art to maintain spatial relationships
Present user stories in structured format with clear headings
Show interaction flows with original ASCII state diagrams
Include step-by-step user journeys as numbered lists
Display edge cases and error states visually
Do NOT summarize the design - present it exactly as designed with full ASCII visualization.
agentId: ab381a9d0fcfdfb5c (use SendMessage with to: 'ab381a9d0fcfdfb5c' to continue this agent)
<usage>total_tokens: 54162
tool_uses: 6
duration_ms: 380821</usage>