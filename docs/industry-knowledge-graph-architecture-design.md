# 行业趋势知识图谱系统总体设计

## 1. 背景与目标

当前知识图谱系统已经完成了领域本体约束、轻量实体消歧、结构化查询等基础改造，但技术实现仍然以全量 JSON snapshot、NetworkX 内存图、前端局部过滤为中心。这种方式适合小规模演示，不适合作为多人网站上的行业趋势分析系统。

新的系统目标是支撑：

- 1 万篇以上文档，后续包括新闻、论文、投融资信息、政策文本等多源数据。
- 6 万以上实体节点、15 万以上关系边，并继续增长。
- 多人网站访问，查询、分析、图谱展示不能依赖全量图加载。
- 面向行业趋势分析，优先支持“技术演进”场景，后续扩展到供应链风险、资本流向、竞争格局、政策传导等场景。
- 所有结论必须能追溯到原始文档证据。

本设计认可并继承 `knowledge-graph-domain-ontology-development.md` 中的核心原则：

- 实体类型和关系类型必须受控。
- LLM 只负责抽取和组织表达，不允许自由编造图谱事实。
- 实体消歧要有明确规则。
- 关系必须保留置信度和证据。
- 旧知识图谱相关数据、代码、API、前端页面和 snapshot 文件都不做兼容，允许全部删除。
- 新图谱从原始文档重新构建。

但新的系统不再维护巨大 JSON 文件，也不再把全量图加载到 NetworkX 后再查询。

## 2. 总体架构

采用：

```text
PostgreSQL + Neo4j + 向量检索 + 场景包
```

职责划分：

```text
原始文档
  -> PostgreSQL 保存文档、抽取结果、证据、任务状态、指标表
  -> 实体消歧与关系归并
  -> Neo4j 保存可查询和可分析的行业图谱
  -> 向量检索保存文档片段、摘要、论文段落、政策段落等语义索引
  -> Query Planner 根据用户问题选择分析场景
  -> GraphRAG 汇总图谱结果、指标结果和原文证据
  -> 前端展示答案、趋势图表、证据列表和局部解释子图
```

核心原则：

- PostgreSQL 是事实源和审计源。
- Neo4j 是图查询和图算法执行层。
- 向量检索是语义召回补充，不替代结构化图谱。
- 前端永远只展示局部子图，不展示全量 6 万节点图。
- 多个分析场景共享同一个统一行业图谱，但查询时按场景激活相关实体、关系、指标和算法。

## 3. 技术选型

### 3.1 PostgreSQL

用于保存：

- 原始文档。
- 文档分片。
- 抽取任务状态。
- 标准实体。
- 实体别名。
- 实体强标识。
- 标准关系。
- 关系证据。
- 场景级事实表。
- 场景级指标表。
- 图谱构建版本。

PostgreSQL 适合承担事实存储、事务、审计、后台任务状态管理和复杂筛选。

### 3.2 Neo4j

用于保存：

- 可查询行业图谱。
- 实体节点。
- 聚合关系边。
- 关系权重、时间、置信度、证据数量。
- 图算法所需属性。

Neo4j 用于：

- 多跳路径分析。
- 技术演进路径分析。
- 技术融合发现。
- 中心度分析。
- 社区发现。
- 链接预测。
- 影响路径解释。

后续如需要图算法，优先使用 Neo4j Graph Data Science。

### 3.3 向量检索

用于：

- 用户问题的语义召回。
- 文档证据补充。
- 论文段落、政策段落、投融资公告段落检索。
- 图谱查询无结果时的 fallback。

向量检索不能作为唯一答案来源。趋势分析类问题应优先使用结构化图谱和指标。

## 4. 统一图谱与场景包

系统应分为两层：

```text
统一图谱底座
  - 文档
  - 实体
  - 关系
  - 证据
  - 消歧
  - Neo4j 同步
  - GraphRAG

分析场景包
  - 本体增量
  - 抽取规则
  - 查询模板
  - 指标算法
  - 回答结构
  - 前端展示配置
```

新增场景时，原则上不修改核心图谱引擎，而是新增一个场景包。

建议目录：

```text
backend/app/services/industry_graph/
  core/
    document_service.py
    entity_resolution_service.py
    graph_repository.py
    neo4j_sync_service.py
    query_planner.py
    graph_rag_service.py
  scenarios/
    technology_evolution/
      ontology.yaml
      extraction_prompt.md
      query_templates.cypher
      metrics.py
      answer_templates.md
      scenario.py
    capital_flow/
      ...
    policy_impact/
      ...
```

前端也应按场景组织展示配置：

```text
frontend/src/features/industryGraph/
  scenarios/
    technologyEvolution/
    capitalFlow/
    policyImpact/
```

## 5. 统一实体类型

基础实体类型：

| 类型 | 含义 |
| --- | --- |
| `Company` | 公司、实验室、开源组织、高校、研究机构等组织主体。 |
| `Person` | 创始人、高管、研究员、投资人、政策制定者等关键人物。 |
| `Product` | 产品、模型、平台、工具、SDK、API、开源项目。 |
| `Technology` | 技术、算法、架构、框架、工程组件、技术栈。 |
| `Concept` | 标准、协议、理论、范式、设计原则。 |
| `Feature` | 功能、能力、应用场景、解决的问题。 |
| `Industry` | 行业、赛道、细分市场。 |
| `SupplyItem` | 原材料、零部件、芯片、算力、数据源、云服务等供应要素。 |
| `Policy` | 政策、法规、监管动作、出口管制、行业规范。 |
| `Event` | 发布、融资、并购、诉讼、制裁、合作、涨价等事件。 |
| `InvestmentFirm` | 投资机构、基金、企业战投部门。 |
| `Paper` | 学术论文、技术报告、预印本。 |
| `Patent` | 专利。 |
| `Benchmark` | 评测集、排行榜、测试任务、指标体系。 |
| `Region` | 国家、地区、城市、经济体。 |

现有 6 类实体可映射到新体系：

```text
Organization -> Company
Product      -> Product
Platform     -> Product / SupplyItem / Technology，按语义细分
Technology   -> Technology
Concept      -> Concept
Feature      -> Feature
```

## 6. 统一关系类型

基础关系类型：

| 关系 | 方向 | 含义 |
| --- | --- | --- |
| `DEVELOPED` | `Company/Person -> Product/Technology` | 研发、发布、维护、开源。 |
| `USES` | `Company/Product/Technology -> Technology/Product/Concept` | 使用、集成、调用、采用。 |
| `BUILDS_ON` | `Technology/Product/Paper/Patent -> Technology/Concept/Paper/Patent` | 基于、继承、扩展。 |
| `SUPPORTS` | `Product/Technology -> Feature/Platform/Concept` | 支持、兼容、适配。 |
| `HAS_FEATURE` | `Product -> Feature/Technology` | 具备功能或特性。 |
| `SOLVES` | `Product/Technology -> Feature` | 解决某问题、痛点或应用场景。 |
| `PROPOSES` | `Paper/Patent/Company -> Technology/Concept` | 提出技术、方法、概念。 |
| `EVALUATES_ON` | `Paper/Product/Technology -> Benchmark` | 使用某 benchmark 评估。 |
| `IMPROVES` | `Technology/Product/Paper -> Feature/Benchmark` | 提升某能力、指标或效果。 |
| `BELONGS_TO` | `Company/Product/Technology -> Industry` | 归属行业或赛道。 |
| `SUPPLIES` | `Company/SupplyItem -> Company/Product` | 供应、提供上游资源。 |
| `DEPENDS_ON` | `Company/Product/Technology -> SupplyItem/Technology/Product` | 依赖上游供应项或关键技术。 |
| `COMPETES_WITH` | `Company/Product -> Company/Product` | 显性或隐性竞争。 |
| `PARTNERS_WITH` | `Company -> Company` | 合作、生态联盟。 |
| `INVESTED_IN` | `InvestmentFirm/Company -> Company` | 投资、领投、参投。 |
| `ACQUIRED` | `Company -> Company/Product` | 收购。 |
| `REGULATES` | `Policy/Region -> Industry/Company/Product/SupplyItem` | 政策约束或监管对象。 |
| `IMPACTS` | `Policy/Event -> Industry/Company/Product/Technology/SupplyItem` | 影响、冲击、利好、限制。 |
| `LOCATED_IN` | `Company/Event/SupplyItem -> Region` | 所在地区。 |
| `CITES` | `Paper/Patent -> Paper/Patent` | 引用。 |
| `CONVERGES_WITH` | `Technology -> Technology` | 技术融合、交叉。 |

关系必须包含：

```text
confidence
confidence_score
evidence_count
first_seen_at
last_seen_at
source_document_ids 或 evidence_ids
graph_version
```

## 7. PostgreSQL 核心表

### 7.1 文档表

```sql
documents
- id
- source_type              -- news / paper / funding / policy / patent
- title
- title_zh
- url
- source
- author
- published_at
- collected_at
- language
- content_hash
- content_text
- metadata_json
- created_at
- updated_at
```

```sql
document_chunks
- id
- document_id
- chunk_index
- chunk_text
- token_count
- embedding_id
- metadata_json
```

### 7.2 场景抽取状态

```sql
document_scenario_states
- document_id
- scenario_key             -- technology_evolution / capital_flow / policy_impact
- extractor_version
- content_hash
- status                   -- pending / running / completed / failed / skipped
- last_extracted_at
- last_error
- primary key(document_id, scenario_key, extractor_version)
```

用途：

- 新增场景时只处理相关文档。
- Prompt 或抽取器升级时只重跑指定场景。
- 文档内容变化时只重跑受影响场景。
- 不需要全库盲重跑。

### 7.3 实体表

```sql
kg_entities
- id
- entity_key
- entity_type
- canonical_name
- normalized_name
- description
- properties_json
- degree
- article_count
- first_seen_at
- last_seen_at
- graph_version
- created_at
- updated_at
```

关键索引：

```sql
unique(entity_key)
index(entity_type, normalized_name)
index(entity_type, canonical_name)
```

### 7.4 实体名称表

```sql
kg_entity_names
- id
- entity_id
- entity_type
- name
- normalized_name
- name_kind                -- canonical / alias / mention
- source_document_id
- created_at
```

关键索引：

```sql
index(entity_type, normalized_name)
index(entity_id)
```

### 7.5 实体强标识表

```sql
kg_entity_identities
- id
- entity_id
- identity_type            -- github_url / official_site / paper_url / arxiv_id / doi / model_url / patent_id
- identity_value
- normalized_value
- created_at
```

关键索引：

```sql
unique(identity_type, normalized_value)
index(entity_id)
```

### 7.6 关系表

```sql
kg_relations
- id
- source_entity_id
- target_entity_id
- relation_type
- confidence
- confidence_score
- weight
- evidence_count
- first_seen_at
- last_seen_at
- properties_json
- graph_version
- created_at
- updated_at
```

关键索引：

```sql
unique(source_entity_id, target_entity_id, relation_type)
index(source_entity_id, relation_type, target_entity_id)
index(target_entity_id, relation_type, source_entity_id)
index(relation_type, confidence)
```

### 7.7 关系证据表

```sql
kg_relation_evidence
- id
- relation_id
- document_id
- chunk_id
- evidence_snippet
- confidence
- confidence_score
- extraction_run_id
- snippet_hash
- scenario_key
- created_at
```

关键索引：

```sql
index(relation_id)
index(document_id)
index(scenario_key, document_id)
unique(relation_id, document_id, snippet_hash)
```

### 7.8 聊天会话与推荐问题表

行业图谱的主要交互形态是聊天式报告流。用户进入页面时，系统先展示每天根据热点生成的问题建议；用户选择或自行输入问题后，系统以流式方式输出文本、趋势卡片、证据卡片和局部知识图谱，并支持继续追问。

推荐问题表：

```sql
industry_graph_suggested_questions
- id
- question
- scenario_key
- reason
- source_period_start
- source_period_end
- hot_entities_json
- priority
- generated_for_date
- created_at
```

会话表：

```sql
industry_graph_conversations
- id
- user_id
- title
- primary_scenario
- created_at
- updated_at
```

消息表：

```sql
industry_graph_messages
- id
- conversation_id
- role                    -- user / assistant / system
- content_text
- content_blocks_json     -- 文本、卡片、图谱、证据等结构化块
- query_plan_json
- metadata_json
- created_at
```

这些表不替代图谱事实表，只保存用户交互和报告输出。

## 8. Neo4j 图模型

Neo4j 节点：

```cypher
(:Company {entity_id, entity_key, name, normalized_name, graph_version})
(:Technology {...})
(:Paper {...})
(:Product {...})
(:Policy {...})
(:Industry {...})
```

Neo4j 关系：

```cypher
(:Paper)-[:PROPOSES {
  relation_id,
  confidence_score,
  evidence_count,
  first_seen_at,
  last_seen_at,
  graph_version
}]->(:Technology)
```

Neo4j 不保存大段证据正文，只保存 `relation_id`、`evidence_count` 和必要摘要字段。证据详情从 PostgreSQL 拉取。

推荐约束：

```cypher
CREATE CONSTRAINT entity_key_unique IF NOT EXISTS
FOR (n:Entity) REQUIRE n.entity_key IS UNIQUE;

CREATE INDEX entity_type_name IF NOT EXISTS
FOR (n:Entity) ON (n.entity_type, n.normalized_name);
```

具体实现时可以采用单标签 `:Entity` + `entity_type`，也可以采用多标签 `:Entity:Technology`。推荐多标签，便于 Cypher 可读性和图算法投影。

## 9. 实体消歧策略

实体合并优先级：

1. 强标识匹配：`doi`、`arxiv_id`、`github_url`、`official_site`、`patent_id`、`model_url`。
2. 同类型 canonical name 精确匹配。
3. 同类型 alias 命中。
4. 同类型 normalized name 命中。
5. 内置别名表命中。
6. 场景特定规则命中。
7. 向量相似 + 规则阈值命中。
8. 不确定则不合并。

不建议第一版引入 LLM 二次合并决策。实体合并错误的破坏性比重复节点更大。

必须支持实体合并审计：

```sql
kg_entity_merge_logs
- id
- source_entity_id
- target_entity_id
- merge_reason
- merged_by
- created_at
- before_json
- after_json
```

第一版可以先不做人工审核后台，但 merge log 应预留。

## 10. 图谱构建与版本化

重建流程：

```text
创建 graph_version = N+1
  -> 筛选需要处理的 documents
  -> 按场景运行抽取
  -> 实体消歧
  -> 写入 PostgreSQL 实体、关系、证据
  -> 聚合关系权重和证据数
  -> 同步到 Neo4j staging version
  -> 运行质量检查
  -> 计算指标
  -> 切换 active_graph_version = N+1
  -> 归档或删除上一 active version
```

版本表：

```sql
kg_graph_builds
- id
- graph_version
- status
- trigger_source
- scenario_keys
- total_documents
- processed_documents
- failed_documents
- entity_count
- relation_count
- evidence_count
- started_at
- completed_at
- error_message
- metadata_json
```

查询服务只读取 active graph version。

优点：

- 重建过程中当前 active version 可继续查询。
- 新图校验失败不会污染线上结果。
- 可以按场景增量重建。

## 11. 场景包机制

一个场景包应定义：

```text
ontology.yaml          -- 新增实体、关系、属性约束
extraction_prompt.md   -- 场景抽取 prompt
query_templates.cypher -- 图查询模板
metrics.py             -- 指标计算
answer_templates.md    -- 回答结构
scenario.py            -- 场景注册入口
```

场景包接口：

```python
class AnalysisScenario:
    key: str
    name: str
    supported_source_types: set[str]

    def classify_question(self, question: str) -> float:
        ...

    def extract(self, document: Document) -> ExtractionResult:
        ...

    def plan_query(self, question: str, entities: list[LinkedEntity]) -> QueryPlan:
        ...

    def run_analysis(self, plan: QueryPlan) -> AnalysisResult:
        ...

    def render_answer_context(self, result: AnalysisResult) -> dict:
        ...
```

新增场景时，不改核心服务，只新增场景包并注册。

## 12. 查询规划器

用户问题不能默认使用所有场景数据。系统需要查询规划器。

流程：

```text
用户问题
  -> 意图分类
  -> 时间范围解析
  -> 实体链接
  -> 选择 1 个主场景 + 0 到 2 个辅助场景
  -> 生成结构化 QueryPlan
  -> 调用 Neo4j / PostgreSQL / 向量检索
  -> 汇总证据
  -> LLM 生成答案
  -> 返回局部子图和指标
```

示例：

用户问：

```text
最近 3 个月技术方面有什么新的变化趋势？
```

规划器输出：

```json
{
  "primary_scenario": "technology_evolution",
  "secondary_scenarios": [],
  "time_range": {
    "relative": "last_3_months"
  },
  "analysis_tasks": [
    "trend_detection",
    "technology_clustering",
    "evidence_retrieval"
  ],
  "output": [
    "summary",
    "ranked_trends",
    "local_graph",
    "evidence"
  ]
}
```

用户问：

```text
为什么某个技术方向突然升温？
```

规划器可以输出：

```json
{
  "primary_scenario": "technology_evolution",
  "secondary_scenarios": ["capital_flow", "policy_impact"],
  "analysis_tasks": [
    "trend_detection",
    "capital_signal_check",
    "policy_signal_check"
  ]
}
```

## 13. 技术演进场景设计

第一版优先实现 `technology_evolution`。

### 13.1 目标问题

需要回答：

- 最近 3 个月技术方面有什么新的变化趋势？
- 某个技术方向是否正在升温？
- 哪些技术正在融合？
- 某项技术从论文到产品的扩散路径是什么？
- 哪些公司正在押注某条技术路线？
- 哪些技术空白区值得关注？
- 哪些 benchmark 或能力指标正在成为竞争焦点？

### 13.2 重点实体

```text
Paper
Patent
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

### 13.3 重点关系

```text
Paper       -[PROPOSES]->     Technology
Paper       -[BUILDS_ON]->    Paper/Technology
Paper       -[EVALUATES_ON]-> Benchmark
Paper       -[IMPROVES]->     Feature/Benchmark
Technology  -[BUILDS_ON]->    Technology/Concept
Technology  -[CONVERGES_WITH]-> Technology
Technology  -[SOLVES]->       Feature
Product     -[USES]->         Technology
Company     -[DEVELOPED]->    Product/Technology
Company     -[PUBLISHED]->    Paper/Patent
Product     -[HAS_FEATURE]->  Feature
Technology  -[BELONGS_TO]->   Industry
```

### 13.4 技术趋势指标

建议第一版指标：

```sql
technology_trend_metrics
- technology_id
- period_start
- period_end
- document_count
- paper_count
- product_count
- company_count
- benchmark_count
- new_relation_count
- adoption_count
- growth_rate
- novelty_score
- convergence_score
- evidence_count
- trend_score
- generated_at
```

指标含义：

- `document_count`：该技术在周期内被多少文档提及。
- `paper_count`：相关论文数量。
- `product_count`：采用该技术的产品数量。
- `company_count`：涉及公司数量。
- `benchmark_count`：相关评测数量。
- `growth_rate`：相对上个周期增长。
- `novelty_score`：新技术、新组合、新关系占比。
- `convergence_score`：与其他技术形成交叉融合的程度。
- `trend_score`：综合热度分。

趋势分可先用规则：

```text
trend_score =
  0.30 * normalized_growth_rate
+ 0.20 * normalized_document_count
+ 0.20 * normalized_company_count
+ 0.15 * normalized_product_count
+ 0.15 * normalized_convergence_score
```

后续可根据人工反馈调整权重。

### 13.5 技术演进查询模板

#### 最近趋势

```cypher
MATCH (t:Technology)
WHERE t.graph_version = $graph_version
WITH t
MATCH (t)<-[r:PROPOSES|USES|BUILDS_ON|IMPROVES|CONVERGES_WITH]-()
WHERE r.last_seen_at >= date($start_date)
RETURN t.entity_id AS technology_id,
       t.name AS technology,
       count(r) AS recent_relation_count,
       sum(coalesce(r.evidence_count, 1)) AS evidence_count
ORDER BY recent_relation_count DESC, evidence_count DESC
LIMIT $limit
```

实际实现中，趋势排序应优先用 PostgreSQL 中的 `technology_trend_metrics`，Neo4j 用于补充路径和子图解释。

#### 技术扩散路径

```cypher
MATCH path =
  (p:Paper)-[:PROPOSES|BUILDS_ON*1..2]->(t:Technology)<-[:USES]-(prod:Product)<-[:DEVELOPED]-(c:Company)
WHERE t.entity_id = $technology_id
RETURN path
LIMIT 50
```

#### 技术融合

```cypher
MATCH (a:Technology)-[r:CONVERGES_WITH]-(b:Technology)
WHERE r.last_seen_at >= date($start_date)
RETURN a, r, b
ORDER BY r.evidence_count DESC
LIMIT $limit
```

### 13.6 回答结构

技术趋势类回答建议固定结构：

```text
1. 总体判断
2. Top 趋势列表
3. 每个趋势的证据
4. 技术演进路径或融合路径
5. 代表公司/产品/论文
6. 不确定性和数据缺口
```

前端展示：

- 趋势榜单。
- 趋势分构成。
- 时间序列折线图。
- 局部技术图谱。
- 证据文档列表。

## 14. 历史数据是否需要重分析

新增场景或指标后，不一定需要重新分析所有历史文档。

### 14.1 不需要重跑 LLM 的情况

只新增指标表，且指标能从已有实体、关系、证据推导。

例如：

```text
technology_trend_metrics
```

如果已有技术、论文、产品、公司关系，则可以直接离线计算。

### 14.2 可以回填的情况

新增事实表，但字段能从已有图谱推导。

例如：

```text
technology_adoption_events
- technology_id
- company_id
- product_id
- event_date
- evidence_id
```

如果已有 `Product - USES -> Technology` 和证据文档日期，则可回填。

### 14.3 需要重跑抽取的情况

新增事实表需要既有抽取没有捕获的信息。

例如资本流向需要：

```text
round
amount
currency
valuation
lead_investor
post_money_valuation
```

如果既有抽取没有这些字段，则需要对投融资文档进行场景级补抽。

### 14.4 推荐原则

```text
原文永远保留
抽取结果可重建
重分析按场景增量执行
不做全库盲重跑
```

## 15. API 设计

建议新增独立 API 前缀：

```text
/api/v1/industry-graph
```

核心接口：

```text
GET  /stats
GET  /suggested-questions
POST /suggested-questions/generate
GET  /conversations
POST /conversations
GET  /conversations/{conversation_id}
GET  /entities/search
GET  /entities/{entity_id}
GET  /entities/{entity_id}/neighborhood
POST /query
POST /query/stream
POST /subgraph
POST /path
GET  /scenarios
GET  /scenarios/{scenario_key}/metrics
POST /builds
GET  /builds
GET  /builds/{build_id}
```

`POST /query` 请求：

```json
{
  "question": "最近 3 个月技术方面有什么新的变化趋势？",
  "conversation_id": null,
  "time_range": {
    "preset": "last_3_months"
  },
  "scenario": "auto",
  "top_k": 10
}
```

响应：

```json
{
  "question": "...",
  "conversation_id": 123,
  "query_plan": {
    "primary_scenario": "technology_evolution",
    "secondary_scenarios": [],
    "analysis_tasks": ["trend_detection"]
  },
  "content_blocks": [],
  "trends": [],
  "entities": [],
  "relations": [],
  "evidence": [],
  "subgraph": {
    "nodes": [],
    "edges": []
  }
}
```

流式接口 `POST /query/stream` 应输出结构化事件，而不是只有纯文本：

```text
query_plan          -- 查询计划
text_delta          -- 正文增量
report_section      -- 报告小节
trend_card          -- 趋势卡片
metric_card         -- 指标卡片
evidence_card       -- 证据卡片
local_graph         -- 局部知识图谱
entity_card         -- 实体卡片
followup_questions  -- 推荐追问
done                -- 结束
error               -- 错误
```

追问时必须传入 `conversation_id`。Query Planner 需要结合最近会话上下文判断省略主语的问题，例如“这个趋势有哪些代表公司？”。

## 16. 前端设计原则

前端采用聊天窗口作为主交互，不采用传统检索页或固定仪表盘作为主入口。整个回答像一篇逐步生成的报告，所有内容都展示在聊天窗口中。

用户进入页面时先看到：

- 当天热点问题建议。
- 常用时间范围选择。
- 自然语言输入框。

用户提问后，聊天窗口流式展示：

- 文本段落。
- 趋势卡片。
- 指标卡片。
- 证据卡片。
- 局部知识图谱。
- 实体详情卡。
- 推荐追问。

用户可以继续追问，前端必须保留会话上下文并传入后端。

前端不展示全量图，只在聊天报告中展示：

- 查询命中的核心实体。
- 解释答案所需的局部路径。
- 趋势指标图表。
- 证据列表。
- 可展开 1 到 2 跳邻域。

技术演进主界面建议包含：

```text
顶部：当天热点问题建议
中间：聊天式报告流
消息块：文本 / 趋势卡 / 证据卡 / 局部图谱 / 推荐追问
底部：问题输入框 + 时间范围选择
侧边抽屉：证据原文、实体详情、图谱节点详情
```

局部图谱节点数量默认控制在 100 到 300，最高不超过 500。

## 17. 后台任务

需要后台任务系统支撑：

- 文档入库。
- 文档分片。
- embedding 生成。
- 场景抽取。
- 实体消歧。
- 关系归并。
- Neo4j 同步。
- 指标计算。
- 图谱版本切换。
- 每日热点问题生成。
- 会话标题摘要和推荐追问生成。

第一版可以继续用现有调度机制或简单后台 worker。多人网站稳定运行后，建议引入队列：

```text
Celery / RQ / Dramatiq
```

任务必须可重试、可查询状态、可按场景重跑。

## 18. 旧知识图谱清理与新系统替换

旧知识图谱不作为兼容对象。旧知识图谱相关的数据、表、服务、API、前端入口、snapshot 文件和测试都应删除或重写。新系统不保留旧入口，不提供旧数据只读模式，也不做旧响应格式兼容。

可以复用的非图谱基础资产：

- 文章原始数据。
- RAG 文档和 embedding 能力。
- 现有 LLM Provider 配置。
- 现有用户、设置、采集、文章管理等与知识图谱无关的系统能力。

必须删除或重写的旧知识图谱内容：

- 旧 `knowledge_graph` 后端服务。
- 旧 `/api/v1/knowledge-graph` API。
- 旧知识图谱 schema、测试和前端页面。
- 旧知识图谱数据表中的数据。
- `current_snapshot.json` 作为事实来源。
- 全量 NetworkX 图查询。
- 基于 snapshot 的节点搜索。
- 前端全量图过滤模式。
- 以 `KnowledgeGraphService` 为中心的大服务类。

替换步骤：

```text
1. 从现有 articles 导入 documents。
2. 删除旧 knowledge_graph 后端模块、API router 和前端入口。
3. 删除旧 snapshot 文件生成、读取和展示逻辑。
4. 清空或移除旧知识图谱表数据。
5. 新增 PostgreSQL schema。
6. 新增 industry_graph 服务模块。
7. 接入 Neo4j。
8. 实现 technology_evolution 场景包。
9. 对历史文章进行技术演进场景抽取。
10. 同步 Neo4j。
11. 实现趋势查询和新前端页面。
```

## 19. 分阶段开发计划

### 阶段一：图谱底座

目标：

- PostgreSQL 新 schema。
- 文档导入。
- 场景抽取状态表。
- 实体、别名、强标识、关系、证据表。
- 实体消歧基础规则。

验收：

- 能从文章中抽取实体、关系、证据并入库。
- 同一实体别名能合并。
- 每条关系能追溯原文证据。

### 阶段二：Neo4j 同步

目标：

- 将 PostgreSQL 聚合实体和关系同步到 Neo4j。
- 支持 active graph version。
- 支持局部子图查询。

验收：

- 能按实体查询 1 跳/2 跳邻域。
- 能执行技术路径查询。
- 查询不依赖全量 JSON 文件。

### 阶段三：技术演进场景

目标：

- `technology_evolution` 场景包。
- 论文、文章、产品、公司、技术关系抽取。
- 技术趋势指标表。
- 最近 3 个月趋势分析接口。

验收：

- 用户问“最近 3 个月技术方面有什么新的变化趋势”，系统能返回趋势榜、解释、证据和局部图。
- 每条趋势至少有证据文档支撑。
- 能区分“热度高”和“增长快”。

### 阶段四：GraphRAG 答案生成

目标：

- 查询规划器。
- 场景选择。
- 图谱结果 + 指标 + 文档证据整合。
- 流式回答。

验收：

- 技术趋势类问题优先走技术演进场景。
- 非技术问题不误用技术演进模板。
- 无结构化结果时能 fallback 到语义检索，并明确说明图谱证据不足。

### 阶段五：新增场景

按优先级新增：

1. 资本流向。
2. 政策传导。
3. 供应链风险。
4. 竞争格局。

每个新增场景只应增加场景包、必要事实表、必要指标表和前端展示配置。

## 20. 验收问题集

技术演进第一版必须支持：

```text
最近 3 个月 AI 技术有什么新趋势？
最近 3 个月哪些技术方向升温最快？
某技术最近有哪些代表论文、产品和公司？
哪些技术正在发生融合？
某项技术从论文到产品的扩散路径是什么？
哪些技术方向证据不足但出现早期信号？
```

后续场景验收问题：

```text
聪明的钱最近从哪些赛道流向了哪些赛道？
某项政策会影响哪些公司和产业节点？
某个供应链节点出问题会影响哪些下游产品？
某公司的真正竞争对手是谁？
```

## 21. 关键风险

### 21.1 实体消歧错误

错误合并比重复节点更危险。第一版宁愿多一些重复节点，也不要激进合并。

### 21.2 关系过度推断

趋势分析容易被弱证据误导。默认只使用：

```text
EXTRACTED
INFERRED 且 confidence_score >= 0.75
```

`AMBIGUOUS` 只能作为辅助信号，不能作为强结论。

### 21.3 场景混用导致答案发散

必须通过 Query Planner 选择主场景和辅助场景，不能每次查询都使用所有数据。

### 21.4 趋势指标被新闻热度污染

新闻提及量不等于技术趋势。趋势分必须结合：

- 论文信号。
- 产品采用。
- 公司数量。
- benchmark 变化。
- 技术融合关系。
- 时间增长率。

### 21.5 前端图谱过载

前端只用于解释结果，不用于全图浏览。任何接口都应限制节点和边数量。

## 22. 设计结论

新的知识图谱系统应定位为：

```text
行业趋势分析图谱系统
```

而不是：

```text
新闻实体关系可视化系统
```

最终架构是：

```text
统一事实库 PostgreSQL
+ 图分析库 Neo4j
+ 向量检索
+ 场景包
+ 查询规划器
+ 局部解释图
```

第一阶段不要同时铺所有分析场景。应先做好 `technology_evolution`，把论文、产品、公司、技术、benchmark、能力提升、证据链打通。这个场景跑通后，再按同样机制扩展资本流向、政策传导、供应链风险和竞争格局。
