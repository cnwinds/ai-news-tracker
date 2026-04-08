# 知识图谱功能设计文档

## 1. 目标

将现有“文章采集 + AI 分析 + RAG 问答”系统升级为“双知识层”系统：

- `RAG` 负责按语义相似度找原文证据。
- `Knowledge Graph` 负责找实体、关系、路径、社区和跨文章结构。
- `Hybrid` 负责把两者结合成更适合真实问答的统一能力。

本轮只交付知识图谱 MVP，要求原生集成到现有后端、设置体系、采集流程与前端问答入口。

## 2. 范围

### 2.1 本轮包含

- 文章知识图谱数据模型
- 基于现有文章结构化字段的确定性构图
- 基于 LLM 的文章语义实体/关系抽取
- 图谱增量同步与手动重建
- 图谱统计、节点、社区、路径、问答 API
- 全局 AI 问答入口中的引擎切换
- Dashboard 图谱页与设置页管理
- 设计文档、TODO、验收记录

### 2.2 本轮不包含

- 独立图数据库（Neo4j）
- 大型交互式图谱画布
- 将 AI 回答自动写回图谱
- 对社交媒体数据进行统一构图

## 3. 关键设计原则

### 3.1 不替代 RAG，而是与 RAG 并存

当前系统已有稳定 RAG 能力：

- 向量索引与文章检索
- AI 流式问答
- 全局 AI 入口复用

知识图谱不替代它，而是新增“结构化导航层”。

### 3.2 不直接把 graphify CLI 当后端依赖

原因：

- graphify 的高价值部分依赖 skill/sub-agent 编排，而非稳定后端库接口。
- 当前项目已有数据库、任务、设置、Provider、Agent 运行时。
- 直接调用外部 CLI 会让服务端行为不稳定，也难以做权限、缓存、错误处理和 UI 适配。

因此本项目只吸收 graphify 的以下思路：

- 图 schema
- `EXTRACTED / INFERRED / AMBIGUOUS`
- `confidence_score`
- BFS / DFS / shortest_path 式查询
- 社区 / god nodes / 报告输出
- 增量检测和缓存

## 4. 总体架构

```text
Article
  -> Deterministic Extraction
  -> Semantic Extraction (LLM)
  -> Entity Resolution
  -> Graph Tables
  -> Snapshot + Report
  -> Query / Path / Community / QA
```

## 5. 数据模型

### 5.1 节点表 `knowledge_graph_nodes`

字段：

- `id`
- `node_key`: 全局唯一键，如 `article:123`、`tag:llm`
- `label`: 展示名称
- `node_type`: `article/source/author/tag/topic/paper/org/model/person/concept/dataset/benchmark`
- `aliases`: 别名列表
- `metadata`: 附加属性
- `created_at`
- `updated_at`

### 5.2 边表 `knowledge_graph_edges`

字段：

- `id`
- `source_node_id`
- `target_node_id`
- `relation_type`
- `confidence`: `EXTRACTED/INFERRED/AMBIGUOUS`
- `confidence_score`
- `weight`
- `source_article_id`
- `evidence_snippet`
- `metadata`
- `created_at`
- `updated_at`

### 5.3 文章同步状态表 `knowledge_graph_article_states`

字段：

- `article_id`
- `content_hash`
- `status`
- `sync_mode`
- `last_synced_at`
- `last_error`

### 5.4 构建运行记录表 `knowledge_graph_builds`

字段：

- `id`
- `status`
- `trigger_source`
- `sync_mode`
- `total_articles`
- `processed_articles`
- `nodes_upserted`
- `edges_upserted`
- `error_message`
- `started_at`
- `completed_at`

## 6. 构图流程

### 6.1 输入材料

优先使用：

- `title`
- `title_zh`
- `summary`
- `detailed_summary`
- `tags`
- `topics`
- `related_papers`
- `author`
- `source`
- `user_notes`

仅在摘要信息不足时回退 `content` 的截断片段。

### 6.2 确定性构图

直接构建以下关系：

- `article -> source`
- `article -> author`
- `article -> tag`
- `article -> topic`
- `article -> paper`

这部分全部标记为：

- `confidence = EXTRACTED`
- `confidence_score = 1.0`

### 6.3 语义抽取

按文章粒度调用 LLM，输出：

- 实体列表
- 关系列表

约束：

- 关系必须带 `confidence` 与 `confidence_score`
- 关系必须能回溯到 `source_article_id`
- 同时输出证据片段 `evidence_snippet`

### 6.4 实体归一

采用“类型 + slug(label)”构造 `node_key`，并将别名写入 `aliases`。

例：

- `org:openai`
- `model:gpt_4o`
- `concept:reasoning_tokens`

### 6.5 快照与报告

同步完成后从数据库重建 NetworkX 图，并生成：

- `current_snapshot.json`
- `latest_report.md`

快照内容包括：

- nodes
- links
- communities
- god_nodes
- article coverage
- build metadata

## 7. 查询能力

### 7.1 节点与社区

- 统计信息
- 节点详情
- 社区列表
- 社区详情

### 7.2 路径与邻域

- shortest path
- BFS 查询
- DFS 查询

### 7.3 问答模式

- `rag`: 仅现有 RAG
- `graph`: 仅图谱上下文
- `hybrid`: 图谱结构 + RAG 证据
- `auto`: 默认等价于 `hybrid`

## 8. 前端融入方式

### 8.1 全局 AI 对话入口

在现有 AI 对话模态层中增加引擎选择：

- Auto
- RAG
- Graph
- Hybrid

同时展示：

- 命中节点
- 命中社区
- 相关文章

### 8.2 Dashboard 新页签

新增“知识图谱”页签：

- 统计
- 手动同步
- 图谱问答
- 路径查询
- 社区浏览

### 8.3 文章详情增强

在文章详情页展示：

- 图谱相关实体
- 所在社区
- 关联文章

## 9. 设置项

新增知识图谱设置：

- `enabled`
- `auto_sync_enabled`
- `run_mode`: `auto/agent/deterministic`
- `max_articles_per_sync`
- `query_depth`

## 10. 增量策略

以 `content_hash` 判断文章是否变化：

- 未变化：跳过语义抽取
- 变化：重算该文章相关节点和边
- 强制重建：清空图谱后全量重建

## 11. 验收标准

1. 能对现有文章完成首次图谱构建。
2. 新文章采集后可自动或手动增量同步。
3. UI 中可查看图谱统计、社区、路径和相关实体。
4. 全局 AI 问答支持 `Auto/RAG/Graph/Hybrid` 切换。
5. `Graph/Hybrid` 回答中能回传结构命中信息与相关文章。
6. 仓库中存在设计文档、TODO、实现总结，并通过基本验证。
