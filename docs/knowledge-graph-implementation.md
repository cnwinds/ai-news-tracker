# 知识图谱功能实现与验收记录

## 1. 目标与结论

本次交付将 `graphify` 的核心思想原生吸收进 `AI News Tracker`，而不是把外部 CLI 包一层接进系统。

最终结果：

- 保留原有 `RAG` 能力
- 新增 `Graph` 与 `Hybrid` 两种问答模式
- 新增知识图谱构建、同步、社区、路径、文章上下文与统一问答能力
- 前端将知识图谱融入 Dashboard、系统设置、全局 AI 对话和文章详情

## 2. 实现概览

### 2.1 后端

已新增知识图谱数据模型：

- `KnowledgeGraphNode`
- `KnowledgeGraphEdge`
- `KnowledgeGraphArticleState`
- `KnowledgeGraphBuild`

已新增知识图谱服务：

- 增量同步与全量重建
- 确定性抽取
- 可选 AI 语义抽取
- 图谱快照构建
- 社区发现
- 路径查询
- Graph / Hybrid / Auto / RAG 模式问答
- 流式问答
- 文章图谱上下文查询

已新增 API：

- `GET /knowledge-graph/stats`
- `POST /knowledge-graph/sync`
- `GET /knowledge-graph/builds`
- `GET /knowledge-graph/nodes`
- `GET /knowledge-graph/nodes/{node_key}`
- `GET /knowledge-graph/communities`
- `GET /knowledge-graph/communities/{community_id}`
- `POST /knowledge-graph/path`
- `POST /knowledge-graph/query`
- `POST /knowledge-graph/query/stream`
- `GET /knowledge-graph/articles/{article_id}/context`
- `GET /settings/knowledge-graph`
- `PUT /settings/knowledge-graph`

### 2.2 前端

已完成以下融入点：

- Dashboard 新增“知识图谱”页签
- 新增知识图谱工作台
  - 统计概览
  - 手动同步
  - 图谱问答
  - 最短路径查询
  - 社区与构建历史
- 系统设置新增“知识图谱”配置页
- 全局 AI 对话新增引擎切换
  - `auto`
  - `rag`
  - `graph`
  - `hybrid`
- AI 对话历史持久化保存以下元数据
  - 引擎
  - 实际解析模式
  - 命中节点
  - 命中社区
  - 相关文章
  - 上下文节点/边数量
- 文章详情弹窗新增图谱上下文
  - 关联实体
  - 命中社区
  - 相关文章

## 3. 关键设计决策

### 3.1 不替代 RAG

知识图谱负责结构化关系与跨文章连接，RAG 负责语义召回与原文证据，两者并存。

### 3.2 不引入独立图库数据库

当前版本使用现有数据库 + NetworkX 快照，不引入 Neo4j，保证部署成本和系统复杂度可控。

### 3.3 不做 graphify 黑盒封装

本项目只吸收 `graphify` 的高价值思想：

- schema 化的节点/边
- `confidence` / `confidence_score`
- shortest path / BFS 风格上下文扩展
- 社区与报告输出

而不会将 graphify CLI 当作运行时依赖接入。

## 4. 额外修复

在补充后端单元测试后，发现知识图谱快照写盘时存在 `datetime` 无法直接 JSON 序列化的问题。

已修复方式：

- 在 `KnowledgeGraphService.rebuild_snapshot()` 中对快照执行 `jsonable_encoder`
- 确保快照文件、快照缓存和后续加载结果都使用 JSON-safe 结构

这是一次真实的行为修复，不是仅为测试适配。

## 5. 验证结果

### 5.1 后端编译检查

已通过：

```bash
python - <<'PY'
import py_compile
files = [
    'backend/app/services/knowledge_graph/service.py',
    'backend/app/api/v1/endpoints/knowledge_graph.py',
    'backend/app/api/v1/endpoints/settings.py',
    'backend/app/services/collector/service.py',
    'backend/app/api/v1/api.py',
    'backend/app/schemas/knowledge_graph.py',
]
for path in files:
    py_compile.compile(path, doraise=True)
print('backend compile ok')
PY
```

### 5.2 后端单元测试

已通过：

```bash
python -m unittest backend.tests.test_knowledge_graph_service -v
```

覆盖点：

- 确定性同步可生成节点、边和快照
- Graph 问答能返回命中节点与相关文章
- 文章图谱上下文可返回实体
- 文章节点到来源节点可找到路径

### 5.3 前端生产构建

已通过：

```bash
cd frontend
npm run build
```

说明：

- 构建存在 Vite 的大包体 warning
- 当前未阻断交付
- 若后续继续演进，可考虑按页签做动态拆包

## 6. 交付文件

核心新增/修改文件包括：

- `backend/app/services/knowledge_graph/service.py`
- `backend/app/api/v1/endpoints/knowledge_graph.py`
- `backend/app/schemas/knowledge_graph.py`
- `backend/app/api/v1/endpoints/settings.py`
- `backend/app/services/collector/service.py`
- `frontend/src/components/KnowledgeGraphPanel.tsx`
- `frontend/src/components/settings/KnowledgeGraphSettingsTab.tsx`
- `frontend/src/components/AIConversationModal.tsx`
- `frontend/src/contexts/AIConversationContext.tsx`
- `frontend/src/components/ArticleDetailModal.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/services/api.ts`
- `docs/knowledge-graph-design.md`
- `docs/knowledge-graph-todo.md`

## 7. 验收结论

本次知识图谱 MVP 已完成并验收通过。

已满足的验收点：

- 可从现有文章构建知识图谱
- 支持采集后的自动同步和手动同步
- 支持图谱统计、社区、节点和路径查询
- 支持统一 AI 对话中的 `Auto / RAG / Graph / Hybrid`
- 支持返回图谱命中信息与相关文章
- 支持系统设置管理知识图谱开关与运行模式
- 仓库内已落地设计文档、TODO 和实现验收文档
