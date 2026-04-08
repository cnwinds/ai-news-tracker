# 知识图谱 V2 实现记录

## 1. 本轮交付

本轮在 MVP 之后继续完成了图谱可视化探索能力，核心结果如下：

- 新增图谱快照视图接口
- 新增图谱 SVG 画布组件
- 新增节点详情探索侧栏
- 支持社区、节点类型、关键词和节点数量过滤

## 2. 后端改动

### 2.1 新增 schema

新增：

- `KnowledgeGraphLinkSummary`
- `KnowledgeGraphSnapshotResponse`

### 2.2 新增服务能力

在 `KnowledgeGraphService` 中新增：

- `get_snapshot_view()`

功能：

- 基于已有快照构造可视化视图
- 按过滤条件筛选节点
- 自动补一跳邻居
- 返回可视化所需 links 与 communities

### 2.3 新增接口

新增：

- `GET /knowledge-graph/snapshot`

## 3. 前端改动

### 3.1 新增组件

新增：

- `frontend/src/components/KnowledgeGraphExplorer.tsx`

能力：

- SVG 图谱画布
- 社区环形布局
- 节点高亮
- 右侧节点详情

### 3.2 融合进原面板

已将 `KnowledgeGraphExplorer` 融入：

- `frontend/src/components/KnowledgeGraphPanel.tsx`

这样 v2 不需要新建一套平行页面，仍沿用当前知识图谱工作台。

### 3.3 类型与 API SDK

已扩展：

- `frontend/src/types/index.ts`
- `frontend/src/services/api.ts`

## 4. 测试与验证项

本轮新增后端自测覆盖：

- `get_snapshot_view()` 基本过滤返回

验证项：

- 后端单元测试通过
- 后端编译检查通过
- 前端生产构建通过

## 5. 结果判断

V2 当前已经把知识图谱从“可问答”推进到“可视化探索”阶段，满足以下目标：

- 用户可看到图谱结构而不是只看列表
- 用户可点击节点钻取具体关系
- 用户可从社区和节点类型进入局部探索

后续如果继续做 V3，更合理的方向是：

- 力导布局与缩放平移
- 画布级别路径高亮
- 社区收拢 / 展开
- 图谱与问答之间的双向联动
