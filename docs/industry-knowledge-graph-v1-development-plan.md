# 行业趋势知识图谱第一版详细开发计划

## 1. 第一版目标

第一版只做一个可上线的最小闭环：

```text
技术演进趋势分析
```

第一版需要支持用户提出：

```text
最近 3 个月技术方面有什么新的变化趋势？
某个技术最近有哪些代表论文、产品和公司？
哪些技术方向升温最快？
哪些技术正在发生融合？
某项技术从论文到产品的扩散路径是什么？
```

系统必须返回：

- 中文趋势总结。
- 趋势榜单。
- 趋势评分和关键指标。
- 代表技术、论文、产品、公司。
- 原文证据列表。
- 用于解释结果的局部图谱。
- 聊天式流式报告输出。
- 可继续追问的会话上下文。

第一版明确不做：

- 全量图谱可视化。
- 所有分析场景一次性做完。
- 完整人工审核后台。
- 复杂链接预测模型。
- 对旧知识图谱做任何兼容。
- 保留旧知识图谱入口或旧数据只读模式。

## 2. 第一版范围

### 2.1 数据源范围

第一版支持：

- 当前已有 AI 新闻文章。
- 后续新增的论文数据。

第一版预留但不完整实现：

- 投融资数据。
- 政策文本。
- 专利数据。

原因：

- 技术演进分析必须优先打通新闻和论文。
- 投融资、政策、专利属于后续场景或辅助信号，不应拖慢第一版。

### 2.2 场景范围

第一版只实现：

```text
technology_evolution
```

后续场景只做架构预留：

```text
capital_flow
policy_impact
supply_chain_risk
competition_landscape
```

### 2.3 数据规模目标

第一版按以下规模设计和验收：

```text
documents: 10,000+
entities: 60,000+
relations: 150,000+
```

前端单次局部图谱响应限制：

```text
nodes <= 300，硬上限 500
edges <= 800，硬上限 1500
```

## 3. 总体开发顺序

建议按 8 个阶段推进：

```text
阶段 0：旧知识图谱清理与新系统骨架
阶段 1：PostgreSQL 事实库 schema
阶段 2：技术演进抽取与实体消歧
阶段 3：Neo4j 同步与局部图查询
阶段 4：技术趋势指标计算
阶段 5：查询规划器与 GraphRAG 回答
阶段 6：前端技术演进页面
阶段 7：验收、压测、正式入口
```

每个阶段都要可独立提交、可测试、可回滚。

## 4. 阶段 0：旧知识图谱清理与新系统骨架

### 4.1 目标

删除旧知识图谱包袱，建立全新的行业图谱模块骨架。旧知识图谱相关数据、代码、API、前端入口、snapshot 文件和测试不做兼容、不保留入口、不保留只读模式。

### 4.2 后端任务

新增模块目录：

```text
backend/app/services/industry_graph/
  __init__.py
  core/
  scenarios/
```

新增 API 目录：

```text
backend/app/api/v1/endpoints/industry_graph.py
```

新增 schema：

```text
backend/app/schemas/industry_graph.py
```

新增配置项：

```text
INDUSTRY_GRAPH_ENABLED
INDUSTRY_GRAPH_ACTIVE_VERSION
NEO4J_URI
NEO4J_USERNAME
NEO4J_PASSWORD
NEO4J_DATABASE
```

删除旧知识图谱后端入口：

```text
backend/app/services/knowledge_graph/
backend/app/api/v1/endpoints/knowledge_graph.py
backend/app/schemas/knowledge_graph.py
```

移除旧 `/api/v1/knowledge-graph` router 注册。

清理旧 snapshot 依赖：

```text
backend/app/data/knowledge_graph/current_snapshot.json
backend/app/data/knowledge_graph/latest_report.md
```

这些文件不再作为事实来源，也不再由新系统生成。

### 4.3 前端任务

新增目录：

```text
frontend/src/features/industryGraph/
  shared/
  scenarios/
    technologyEvolution/
```

删除旧知识图谱前端页面和旧入口。新导航只保留“行业趋势图谱”入口。

### 4.4 验收标准

- 后端能启动。
- 新 API router 能注册。
- 旧 `/knowledge-graph` API 不再作为可用功能暴露。
- 前端不再出现旧知识图谱入口。
- 前端能看到空的“行业趋势图谱”入口。

## 5. 阶段 1：PostgreSQL 事实库 schema

### 5.1 目标

建立可审计、可重建、可按场景增量抽取的事实库。

### 5.2 数据库表

新增核心表：

```text
documents
document_chunks
document_scenario_states
kg_entities
kg_entity_names
kg_entity_identities
kg_relations
kg_relation_evidence
kg_graph_builds
industry_graph_suggested_questions
industry_graph_conversations
industry_graph_messages
```

如果项目短期仍使用 SQLite 开发环境，schema 要尽量保持 SQLAlchemy 跨库可运行；生产建议使用 PostgreSQL。

### 5.3 SQLAlchemy model

新增或调整：

```text
backend/app/db/models.py
```

建议模型命名：

```text
IndustryDocument
IndustryDocumentChunk
IndustryDocumentScenarioState
IndustryGraphEntity
IndustryGraphEntityName
IndustryGraphEntityIdentity
IndustryGraphRelation
IndustryGraphRelationEvidence
IndustryGraphBuild
```

### 5.4 文档导入

从现有 `articles` 表导入到 `documents`：

```text
Article -> IndustryDocument
source_type = news
content_hash = title + summary + detailed_summary + content
```

第一版不删除 `articles` 原始文章表。

### 5.5 索引要求

实体：

```text
unique(entity_key)
index(entity_type, normalized_name)
index(entity_type, canonical_name)
```

名称：

```text
index(entity_type, normalized_name)
index(entity_id)
```

强标识：

```text
unique(identity_type, normalized_value)
index(entity_id)
```

关系：

```text
unique(source_entity_id, target_entity_id, relation_type)
index(source_entity_id, relation_type, target_entity_id)
index(target_entity_id, relation_type, source_entity_id)
index(relation_type, confidence)
```

证据：

```text
index(relation_id)
index(document_id)
index(scenario_key, document_id)
unique(relation_id, document_id, snippet_hash)
```

### 5.6 测试

新增测试：

```text
backend/tests/test_industry_graph_models.py
backend/tests/test_industry_graph_document_import.py
```

测试点：

- 表能创建。
- 文档导入幂等。
- content_hash 变化能识别。
- 关键唯一约束生效。

### 5.7 验收标准

- 能从现有文章导入 `documents`。
- 每篇文档有稳定 `content_hash`。
- 重复导入不会产生重复文档。
- 场景状态表能记录 `technology_evolution` 的 pending/completed/failed。
- 能保存每日推荐问题。
- 能保存用户会话和聊天消息。

## 6. 阶段 2：技术演进抽取与实体消歧

### 6.1 目标

从新闻和论文中抽取技术演进相关实体、关系和证据。

### 6.2 场景包目录

新增：

```text
backend/app/services/industry_graph/scenarios/technology_evolution/
  __init__.py
  ontology.yaml
  extraction_prompt.md
  scenario.py
```

### 6.3 第一版本体

实体类型：

```text
Paper
Technology
Concept
Product
Company
Person
Benchmark
Feature
Industry
Event
```

关系类型：

```text
PROPOSES
BUILDS_ON
USES
DEVELOPED
PUBLISHED
EVALUATES_ON
IMPROVES
HAS_FEATURE
SOLVES
BELONGS_TO
CONVERGES_WITH
```

### 6.4 LLM 输出格式

统一为：

```json
{
  "entities": [
    {
      "id": "文中名称",
      "canonical_name": "标准名称",
      "type": "Technology",
      "aliases": [],
      "description": "一句话说明",
      "identifiers": {
        "doi": null,
        "arxiv_id": null,
        "github_url": null,
        "official_site": null,
        "paper_url": null
      },
      "properties": {}
    }
  ],
  "relations": [
    {
      "source": "源实体 canonical_name",
      "source_type": "Paper",
      "target": "目标实体 canonical_name",
      "target_type": "Technology",
      "type": "PROPOSES",
      "evidence_snippet": "原文证据",
      "confidence": "EXTRACTED",
      "confidence_score": 0.95,
      "properties": {}
    }
  ]
}
```

### 6.5 抽取服务

新增：

```text
backend/app/services/industry_graph/core/extraction_service.py
backend/app/services/industry_graph/core/entity_resolution_service.py
backend/app/services/industry_graph/core/graph_repository.py
```

职责：

- `ExtractionService`：调用 LLM，解析 JSON，校验实体/关系类型。
- `EntityResolutionService`：实体归一化、别名合并、强标识匹配。
- `GraphRepository`：写入实体、关系、证据、状态。

### 6.6 实体消歧

第一版规则：

1. 强标识匹配：`doi`、`arxiv_id`、`github_url`、`official_site`、`paper_url`。
2. 同类型 normalized canonical name 精确匹配。
3. 同类型 alias 命中。
4. 内置别名表命中。
5. 不确定则创建新实体。

第一版不做 LLM 二次合并。

### 6.7 关系入库规则

入库条件：

```text
confidence_score >= 0.6
relation_type 在 ontology 中
source_entity 和 target_entity 都存在
source != target
```

强查询默认使用：

```text
confidence = EXTRACTED
或 confidence = INFERRED 且 confidence_score >= 0.75
```

### 6.8 场景级增量处理

使用 `document_scenario_states`：

```text
document_id
scenario_key = technology_evolution
extractor_version = v1
content_hash
status
```

只处理：

```text
没有状态
状态 failed 且允许重试
content_hash 改变
extractor_version 升级
```

### 6.9 测试

新增：

```text
backend/tests/test_technology_evolution_extraction.py
backend/tests/test_industry_entity_resolution.py
backend/tests/test_industry_graph_repository.py
```

测试点：

- AGenUI 类文章能抽取 Product、Technology、Concept、Feature、Company。
- 论文类文档能抽取 Paper、Technology、Benchmark。
- alias 能合并。
- 低置信关系不入库。
- 同一篇文档重复处理不产生重复证据。

### 6.10 验收标准

- 能处理一批文章并写入标准实体、关系、证据。
- 每条关系都能查回证据文档和证据片段。
- 失败文档有状态和错误信息。
- 重跑同一批文档结果幂等。

## 7. 阶段 3：Neo4j 同步与局部图查询

### 7.1 目标

将 PostgreSQL 中的聚合实体和关系同步到 Neo4j，并支持局部图查询。

### 7.2 Neo4j 连接服务

新增：

```text
backend/app/services/industry_graph/core/neo4j_client.py
backend/app/services/industry_graph/core/neo4j_sync_service.py
```

### 7.3 Neo4j 节点策略

所有节点带 `:Entity` 标签，同时带类型标签：

```text
:Entity:Technology
:Entity:Paper
:Entity:Product
:Entity:Company
```

节点属性：

```text
entity_id
entity_key
entity_type
name
normalized_name
description
graph_version
first_seen_at
last_seen_at
```

### 7.4 Neo4j 关系策略

关系属性：

```text
relation_id
relation_type
confidence
confidence_score
weight
evidence_count
first_seen_at
last_seen_at
graph_version
```

证据正文不写入 Neo4j。

### 7.5 同步流程

```text
读取 active 或指定 graph_version 的 kg_entities
MERGE Neo4j 节点
读取 kg_relations
MERGE Neo4j 关系
删除或隔离上一 active graph_version 数据
```

第一版可以先做全量同步；后续再做增量同步。

### 7.6 局部图 API

新增：

```text
GET /api/v1/industry-graph/entities/search
GET /api/v1/industry-graph/entities/{entity_id}
GET /api/v1/industry-graph/entities/{entity_id}/neighborhood
POST /api/v1/industry-graph/subgraph
POST /api/v1/industry-graph/path
```

局部图限制：

```text
depth <= 2
limit_nodes 默认 150，最大 500
limit_edges 默认 400，最大 1500
```

### 7.7 测试

新增：

```text
backend/tests/test_industry_neo4j_sync.py
backend/tests/test_industry_graph_subgraph_api.py
```

如果 CI 没有 Neo4j，可以把 Neo4j 测试分为：

- repository 单元测试。
- Neo4j 集成测试，默认跳过，需要环境变量开启。

### 7.8 验收标准

- PostgreSQL 实体和关系能同步到 Neo4j。
- 能按实体查 1 跳/2 跳邻域。
- 局部图响应不依赖 JSON snapshot。
- 响应节点和边数量受限。

## 8. 阶段 4：技术趋势指标计算

### 8.1 目标

让系统能回答“最近 3 个月技术方面有什么新的变化趋势”。

### 8.2 指标表

新增：

```text
technology_trend_metrics
```

字段：

```text
technology_id
period_start
period_end
document_count
paper_count
product_count
company_count
benchmark_count
new_relation_count
adoption_count
growth_rate
novelty_score
convergence_score
evidence_count
trend_score
generated_at
```

### 8.3 指标计算服务

新增：

```text
backend/app/services/industry_graph/scenarios/technology_evolution/metrics.py
```

计算周期：

```text
最近 30 天
最近 90 天
自然月
自然季度
```

第一版必须支持：

```text
last_3_months
```

### 8.4 第一版趋势分公式

先用规则公式：

```text
trend_score =
  0.30 * normalized_growth_rate
+ 0.20 * normalized_document_count
+ 0.20 * normalized_company_count
+ 0.15 * normalized_product_count
+ 0.15 * normalized_convergence_score
```

其中：

- `growth_rate`：当前周期文档/关系数量相对上一周期增长。
- `document_count`：新闻和论文中的出现频次。
- `company_count`：涉及公司数量。
- `product_count`：采用或发布相关产品数量。
- `convergence_score`：与其他技术的交叉关系数量和证据数。

### 8.5 趋势解释数据

每个趋势项返回：

```text
technology
trend_score
growth_rate
document_count
paper_count
product_count
company_count
top_companies
top_products
top_papers
evidence
subgraph_seed_entity_ids
```

### 8.6 测试

新增：

```text
backend/tests/test_technology_trend_metrics.py
```

测试点：

- 指标能按时间范围计算。
- 上一周期为 0 时增长率处理合理。
- 趋势排序稳定。
- 证据数量不足的趋势不会排名过高。

### 8.7 验收标准

- 能生成最近 3 个月技术趋势榜。
- 每个趋势有评分构成。
- 每个趋势有证据文档。
- 能区分“总量高”和“增长快”。

## 9. 阶段 5：查询规划器与聊天式 GraphRAG 报告

### 9.1 目标

用户输入自然语言问题后，系统能选择技术演进场景，并在聊天窗口中流式生成一篇结构化报告。用户可以继续追问，系统需要结合会话上下文回答。

### 9.2 Query Planner

新增：

```text
backend/app/services/industry_graph/core/query_planner.py
```

第一版支持：

```text
primary_scenario = technology_evolution
time_range = last_3_months / explicit date range
analysis_tasks = trend_detection / technology_detail / technology_path / convergence_detection
conversation_context = 最近若干轮用户问题和助手报告摘要
```

第一版可以采用规则 + LLM 辅助：

- 明确出现“技术趋势、技术变化、最近技术、升温、融合、论文、产品采用”时走技术演进。
- 无法分类时 fallback 到通用语义检索。

### 9.3 查询计划结构

```json
{
  "primary_scenario": "technology_evolution",
  "secondary_scenarios": [],
  "time_range": {
    "preset": "last_3_months"
  },
  "analysis_tasks": ["trend_detection"],
  "entities": [],
  "output": ["summary", "ranked_trends", "local_graph", "evidence"]
}
```

### 9.4 GraphRAG Answer Service

新增：

```text
backend/app/services/industry_graph/core/graph_rag_answer_service.py
backend/app/services/industry_graph/core/conversation_service.py
backend/app/services/industry_graph/core/suggested_question_service.py
```

输入：

```text
query_plan
trend_metrics
neo4j_subgraph
relation_evidence
vector_search_results
conversation_history
```

输出：

```text
content_blocks
trends
entities
relations
evidence
subgraph
followup_questions
```

`content_blocks` 用于保存聊天报告里的结构化内容：

```text
text
report_section
trend_card
metric_card
evidence_card
local_graph
entity_card
followup_questions
```

### 9.5 回答约束

LLM 回答必须：

- 使用中文。
- 明确说明趋势来源。
- 引用证据编号。
- 对证据不足的趋势标注“不确定”。
- 不把向量检索结果当作结构化事实。
- 追问时继承当前会话上下文，但不能把历史回答当成事实源。

### 9.6 API

新增：

```text
GET  /api/v1/industry-graph/suggested-questions
POST /api/v1/industry-graph/suggested-questions/generate
GET  /api/v1/industry-graph/conversations
POST /api/v1/industry-graph/conversations
GET  /api/v1/industry-graph/conversations/{conversation_id}
POST /api/v1/industry-graph/query
POST /api/v1/industry-graph/query/stream
```

请求：

```json
{
  "question": "最近 3 个月技术方面有什么新的变化趋势？",
  "conversation_id": null,
  "scenario": "auto",
  "time_range": {
    "preset": "last_3_months"
  },
  "top_k": 10
}
```

响应：

```json
{
  "question": "...",
  "conversation_id": 123,
  "query_plan": {},
  "content_blocks": [],
  "trends": [],
  "evidence": [],
  "subgraph": {
    "nodes": [],
    "edges": []
  }
}
```

流式事件：

```text
query_plan
text_delta
report_section
trend_card
metric_card
evidence_card
local_graph
entity_card
followup_questions
done
error
```

### 9.7 每日热点问题生成

新增后台任务：

```text
generate_daily_industry_graph_questions
```

输入：

```text
最近 24 小时/7 天文章
最近 30/90 天技术趋势指标
热点实体和关系变化
```

输出：

```text
industry_graph_suggested_questions
```

问题示例：

```text
最近 3 个月哪些 AI Agent 技术路线升温最快？
最近哪些技术从论文进入产品应用？
GraphRAG 最近有哪些新变化？
端侧 AI 的关键技术变化是什么？
```

### 9.8 测试

新增：

```text
backend/tests/test_industry_query_planner.py
backend/tests/test_industry_graph_query_api.py
backend/tests/test_technology_evolution_answer.py
backend/tests/test_industry_graph_conversation.py
backend/tests/test_industry_graph_suggested_questions.py
```

测试点：

- “最近 3 个月技术方面有什么新的变化趋势”能路由到技术演进。
- 没有趋势指标时返回明确提示。
- 有趋势指标时返回趋势、证据和子图。
- 流式接口能输出文本、卡片、证据和局部图谱事件。
- 追问能携带 `conversation_id` 并使用会话上下文。
- 每日热点问题能生成并返回。

### 9.9 验收标准

- 用户问题能返回结构化趋势结果。
- 回答中的每个关键趋势有证据。
- 查询不扫描全量 JSON，不加载全量 NetworkX。
- 聊天窗口能流式收到文本、卡片、证据和局部图谱。
- 用户能基于同一会话继续追问。
- 页面初始状态能展示当天热点问题建议。

## 10. 阶段 6：前端聊天式技术演进页面

### 10.1 目标

新增面向用户的聊天式技术演进分析页面。用户进入页面先看到系统生成的热点问题建议；提问后，所有结果像报告一样流式输出在聊天窗口中，包括文本、趋势卡片、指标卡片、证据卡片和局部知识图谱。用户可以继续追问。

### 10.2 前端目录

新增：

```text
frontend/src/features/industryGraph/
  shared/
    ChatReport.tsx
    ChatMessage.tsx
    SuggestedQuestionList.tsx
    ReportBlockRenderer.tsx
    EvidenceList.tsx
    LocalGraph.tsx
    EntityDetailDrawer.tsx
    QueryBox.tsx
    TimeRangeSelect.tsx
  scenarios/
    technologyEvolution/
      TechnologyEvolutionPage.tsx
      TechnologyTrendCard.tsx
      TrendMetricCard.tsx
      TechnologyPathPanel.tsx
      TrendEvidencePanel.tsx
      config.ts
```

### 10.3 页面结构

建议布局：

```text
顶部：当天热点问题建议
中间：聊天式报告流
消息块：文本 / 趋势卡 / 指标卡 / 证据卡 / 局部图谱 / 推荐追问
底部：问题输入框 + 时间范围选择
侧边抽屉：证据原文、实体详情、图谱节点详情
```

第一屏不做仪表盘，不做固定三栏分析台。核心体验是“提问 -> 生成报告 -> 继续追问”。

### 10.4 通用组件复用

新前端只复用通用 UI/交互能力，不复用旧知识图谱页面结构和 “snapshot 全图加载”模式。

新 `LocalGraph` 只接受后端返回的局部图：

```text
nodes
edges
highlighted_paths
```

不在前端做全量节点过滤。

### 10.5 API Client

新增：

```text
frontend/src/services/industryGraphApi.ts
```

接口：

```text
getSuggestedIndustryGraphQuestions()
createIndustryGraphConversation()
getIndustryGraphConversation()
queryIndustryGraph()
streamIndustryGraphQuery()
searchIndustryGraphEntities()
getIndustryGraphEntity()
getIndustryGraphNeighborhood()
```

### 10.6 类型定义

新增：

```text
frontend/src/types/industryGraph.ts
```

核心类型：

```text
IndustryGraphQueryPlan
IndustryGraphTrend
IndustryGraphEvidence
IndustryGraphNode
IndustryGraphEdge
IndustryGraphSubgraph
IndustryGraphConversation
IndustryGraphMessage
IndustryGraphContentBlock
IndustryGraphStreamEvent
IndustryGraphQueryResponse
```

### 10.7 测试

新增：

```text
frontend/src/features/industryGraph/scenarios/technologyEvolution/TechnologyEvolutionPage.test.tsx
frontend/src/features/industryGraph/shared/ChatReport.test.tsx
frontend/src/features/industryGraph/shared/ReportBlockRenderer.test.tsx
frontend/src/features/industryGraph/shared/LocalGraph.test.tsx
```

测试点：

- 页面初始能展示热点问题建议。
- 点击建议问题能发起查询。
- 页面能提交自定义查询。
- 能流式展示文本、趋势卡、证据卡和局部图谱。
- 能继续追问并保留会话上下文。
- 后端返回空结果时显示合理空态。
- 局部图节点数量较多时页面不卡死。

### 10.8 验收标准

- 用户能在页面输入问题并看到趋势分析。
- 热点问题建议、聊天报告流、证据、局部图能联动。
- 点击趋势卡能聚焦对应局部图。
- 用户能在同一会话中继续追问。
- 不会请求旧 `current_snapshot.json`。

## 11. 阶段 7：验收、压测、正式入口

### 11.1 功能验收问题

必须通过：

```text
最近 3 个月技术方面有什么新的变化趋势？
最近 3 个月哪些技术方向升温最快？
GraphRAG 最近有什么新变化？
哪些技术正在发生融合？
某个技术最近有哪些代表论文、产品和公司？
```

### 11.2 数据质量验收

抽样检查：

- 每个 Top 趋势至少 3 条证据。
- 趋势解释中的公司、产品、论文能在图谱中找到。
- 证据片段能在原文中找到。
- 不出现明显错合并实体。
- 不出现没有证据的强结论。

### 11.3 性能验收

目标：

```text
趋势查询 P95 <= 5 秒，不含 LLM 生成
局部子图查询 P95 <= 2 秒
实体搜索 P95 <= 1 秒
趋势指标离线计算 10,000 文档规模 <= 10 分钟
前端局部图 300 节点内可流畅交互
```

LLM 回答可流式输出，首 token 目标：

```text
<= 5 秒
```

### 11.4 稳定性验收

- Neo4j 不可用时，API 返回明确降级信息。
- 指标表为空时，返回“暂无足够趋势数据”。
- 抽取任务失败不会影响查询服务。
- 后台重建图谱时当前 active graph_version 仍可查询。
- 推荐问题生成失败时，用户仍可手动提问。
- 流式输出中断时，会话保留已生成内容并允许重试。

### 11.5 上线策略

第一版上线时：

- 旧知识图谱入口已删除。
- 新增正式“行业趋势图谱”入口。
- 旧 snapshot 图谱不再作为用户可访问功能存在。

## 12. 开发任务拆分

### 12.1 后端任务清单

```text
BE-01 新增 industry_graph 模块和 API router
BE-02 新增配置项和 Neo4j 连接配置
BE-03 新增 PostgreSQL/SQLAlchemy schema
BE-04 实现 articles -> documents 导入
BE-05 实现 document_scenario_states
BE-06 实现 technology_evolution ontology
BE-07 实现 LLM 抽取服务
BE-08 实现实体消歧服务
BE-09 实现关系和证据写入
BE-10 实现场景级增量抽取
BE-11 实现 Neo4j client
BE-12 实现 Neo4j 全量同步
BE-13 实现实体搜索和局部图查询
BE-14 实现 technology_trend_metrics
BE-15 实现趋势指标计算任务
BE-16 实现 Query Planner
BE-17 实现会话服务和消息持久化
BE-18 实现每日热点问题生成服务
BE-19 实现行业图谱 query API
BE-20 实现结构化流式回答 API
BE-21 增加后端测试
BE-22 增加压测脚本和诊断接口
```

### 12.2 前端任务清单

```text
FE-01 新增 industryGraph 类型定义
FE-02 新增 industryGraphApi
FE-03 新增行业趋势图谱正式路由入口
FE-04 实现 SuggestedQuestionList
FE-05 实现 ChatReport 和 ChatMessage
FE-06 实现 ReportBlockRenderer
FE-07 实现 QueryBox 和 TimeRangeSelect
FE-08 实现 TechnologyEvolutionPage
FE-09 实现 TechnologyTrendCard 和 TrendMetricCard
FE-10 实现 EvidenceList
FE-11 实现 LocalGraph
FE-12 实现趋势卡、证据卡与局部图联动
FE-13 实现追问会话上下文
FE-14 实现空态、错误态、加载态、中断重试
FE-15 增加前端测试
```

### 12.3 运维与数据任务

```text
OPS-01 准备 PostgreSQL 环境
OPS-02 准备 Neo4j 环境
OPS-03 配置备份策略
OPS-04 配置后台任务运行方式
OPS-05 准备一批技术演进验收样本
OPS-06 准备定期指标计算任务
OPS-07 配置每日热点问题生成任务
```

## 13. 推荐提交顺序

建议按以下 PR 或提交批次：

```text
PR 1: 新模块骨架 + 配置 + 空 API
PR 2: PostgreSQL schema + 文档导入
PR 3: 技术演进抽取 + 实体消歧 + 证据入库
PR 4: Neo4j 同步 + 局部图 API
PR 5: 趋势指标表 + 指标计算
PR 6: Query Planner + query API + 聊天式 GraphRAG 报告
PR 7: 前端聊天式技术演进页面
PR 8: 验收测试 + 压测 + 正式入口
```

每个 PR 必须带测试，不能堆到最后一次性验证。

## 14. 主要风险与处理

### 14.1 Neo4j 引入复杂度

风险：

```text
部署、连接、测试、数据同步都会增加复杂度。
```

处理：

```text
第一版 Neo4j 集成测试允许通过环境变量开启。
PostgreSQL 保留完整事实源。
Neo4j 可重建，不作为唯一数据源。
```

### 14.2 趋势结果被新闻热度误导

风险：

```text
某技术被大量新闻转述，但实际没有技术进展。
```

处理：

```text
趋势分不要只看 document_count。
必须加入 paper_count、product_count、company_count、convergence_score。
回答中区分“媒体热度”和“技术进展”。
```

### 14.3 实体错误合并

风险：

```text
错误合并会污染趋势指标和路径分析。
```

处理：

```text
第一版宁愿保留重复节点，也不要激进合并。
强标识优先。
保留 merge log。
```

### 14.4 LLM 抽取不稳定

风险：

```text
JSON 格式错误、类型越界、关系幻觉。
```

处理：

```text
严格 schema 校验。
非法实体/关系丢弃。
低置信关系不入库。
失败文档可重试。
```

### 14.5 前端图谱过载

风险：

```text
局部子图过大导致卡顿。
```

处理：

```text
后端限制节点和边数量。
前端只渲染后端返回的局部图。
默认展示 Top 路径和 Top 证据。
```

## 15. 第一版完成标准

第一版完成需要同时满足：

```text
1. 技术演进文档能批量抽取入库。
2. 实体、关系、证据可追溯。
3. Neo4j 能查询局部图。
4. 最近 3 个月趋势指标能计算。
5. 用户能通过自然语言查询趋势。
6. 回答包含趋势、证据、局部图。
7. 前端有可用的技术演进页面。
8. 查询不依赖全量 JSON snapshot。
9. 10,000 文档、60,000 节点、150,000 边规模下核心查询仍可用。
```

第一版上线后，再进入第二版：

```text
资本流向场景
政策传导场景
更强实体审核
更复杂技术融合/空白区算法
Neo4j GDS 深度算法
```
