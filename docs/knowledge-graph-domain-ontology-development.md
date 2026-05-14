# 知识图谱领域本体与消歧改造开发文档

## 1. 目标

将现有知识图谱从“开放式实体关系抽取”改造为“AI 资讯领域本体约束抽取 + 轻量实体消歧 + 结构化图查询”。

核心目标：

- 实体类型稳定，不随 LLM 自由发挥。
- 关系类型稳定，可用于多跳查询和精确推理。
- 同一实体的不同写法能合并，避免图谱碎片化。
- 查询时优先使用结构化图谱关系，GraphRAG 作为补充。

## 2. 改造策略

### 2.1 不兼容旧图谱数据

本次改造不兼容旧知识图谱数据，采用清空后重建的方式。

原因：

- 旧图谱实体类型和关系类型过于开放，质量不可控。
- 新方案使用固定 6 类实体和 6 类关系，旧数据直接兼容会污染新图谱。
- 图谱数据可从文章重新生成，不是必须保留的原始资产。

执行方式：

- 保留 `articles` 表及文章原始数据。
- 清空旧图谱相关数据：
  - `knowledge_graph_nodes`
  - `knowledge_graph_edges`
  - `knowledge_graph_article_states`
  - `knowledge_graph_builds`
- 使用新抽取逻辑从文章重新构建图谱。

### 2.2 数据存储位置

继续复用当前已有表，不引入 Neo4j 或新图库数据库。

节点保存到：

```text
knowledge_graph_nodes
```

核心字段：

```text
id
node_key
label
node_type
aliases
metadata_json
created_at
updated_at
```

边保存到：

```text
knowledge_graph_edges
```

核心字段：

```text
id
source_node_id
target_node_id
relation_type
confidence
confidence_score
source_article_id
evidence_snippet
metadata_json
created_at
updated_at
```

其中 `source_article_id` 是边与原始文章的关联字段，后续用于找回证据文章。

### 2.3 查询方式

第一版查询使用 SQLAlchemy 查询当前数据库表，不依赖 Neo4j。

查询基本逻辑：

1. 根据 `node_type` 找候选节点，例如 `product`。
2. 根据 `relation_type` 找候选边，例如 `BASED_ON`、`SOLVES`。
3. 根据目标节点的 `label`、`aliases`、`metadata_json.canonical_name` 做实体匹配。
4. 多个条件分别得到候选 Product 集合。
5. 对多个集合取交集。
6. 返回命中节点、命中边和相关文章。

### 2.4 节点到文章的关联

节点本身不直接绑定文章，文章证据通过边关联。

每条边都保存：

```text
source_article_id
```

当结构化查询命中某个节点后：

1. 找到该节点参与的命中边。
2. 从命中边读取 `source_article_id`。
3. 使用 `source_article_id` 查询 `articles.id`。
4. 获取文章标题、摘要、正文片段、URL、来源等信息。
5. 将这些文章作为 LLM 回复的证据上下文。

### 2.5 LLM 回复上下文

结构化查询完成后，提供给 LLM 的上下文必须来自图谱命中结果，不让 LLM 自由猜测。

上下文包含：

1. 命中节点：产品名、类型、描述、URL 等。
2. 命中关系：关系类型、源节点、目标节点、证据片段。
3. 相关文章：标题、摘要、URL、来源。

LLM 只负责把结构化事实组织成自然语言回答。

## 3. 本体定义

### 3.1 实体类型

实体类型只能使用以下 6 类。

| 类型 | 定义 | 典型内容 |
| --- | --- | --- |
| `Product` | 用户可使用、部署、下载、访问、调用或集成的具体产物。 | AI 产品、开源项目、框架、大模型、SDK、API、开发工具 |
| `Organization` | 研发、发布、维护、提出、投资或使用产品/技术的主体。 | 公司、实验室、高校、团队、开源社区、重要个人 |
| `Platform` | 产品运行、部署、发布、适配或依赖的外部环境。 | iOS、Android、HarmonyOS、AWS、CUDA、GitHub、Hugging Face |
| `Technology` | 具体技术实现、架构、算法、工程组件、编程语言或技术栈。 | C++ Core、流式架构、Transformer、RAG、LoRA、KV Cache |
| `Concept` | 抽象理论、协议、标准、数据格式、设计原则或行业范式。 | Agent-to-UI、A2UI、MCP、OpenAPI、Design Token、JSON |
| `Feature` | 产品对外提供的功能、能力、应用场景、解决的问题或用户价值。 | 跨平台开发、多端 UI 适配、代码生成、低延迟推理、文档问答 |

### 3.2 关系类型

关系类型只能使用以下 6 类。

| 类型 | 方向 | 定义 |
| --- | --- | --- |
| `DEVELOPED` | `Organization -> Product` | 研发、发布、创建、开源、维护。 |
| `BASED_ON` | `Product/Technology -> Concept/Technology` | 基于、遵循、建立在协议、标准、理论或基础技术之上。 |
| `USES` | `Product/Technology/Organization -> Technology/Concept/Product` | 使用、集成、调用、采用某技术、组件、工具或模型。 |
| `SUPPORTS` | `Product/Technology -> Platform/Concept/Feature` | 支持、兼容、覆盖、适配某平台、协议、格式或能力。 |
| `HAS_FEATURE` | `Product -> Feature/Technology` | 具备某功能、能力、特性或架构。 |
| `SOLVES` | `Product/Technology -> Feature` | 解决某问题、痛点、限制或应用场景。 |

## 4. 实体消歧策略

### 4.1 轻量原则

节点不存重型 `disambiguation` 字段。

统一使用：

- `label`：标准展示名。
- `aliases`：所有被合并的别名。
- `metadata_json.canonical_name`：标准名。
- `metadata_json.description`：简短说明。
- `metadata_json` 中保留 URL、GitHub、官网、论文地址等强标识。

### 4.2 aliases 规则

发生实体合并时：

- `aliases` 记录所有被合并过的名称。
- 包括原文写法、缩写、全称、中英文名、旧节点 label。
- 不记录描述性短语。

示例：

```json
{
  "label": "Agent-to-UI",
  "node_type": "concept",
  "aliases": ["A2UI", "Agent to UI", "Google A2UI协议"],
  "metadata_json": {
    "canonical_name": "Agent-to-UI",
    "description": "Agent 与 UI 之间的交互协议"
  }
}
```

### 4.3 合并优先级

实体入库前按以下顺序匹配已有节点：

1. 强唯一标识匹配：`github_url`、`official_site`、`paper_url`、`model_url`、`arxiv_id`、`doi`。
2. 同类型标准名精确匹配。
3. 同类型 aliases 命中。
4. 类型相同，且 `description` 描述的实际含义一致，则直接合并。
5. 内置别名表命中。
6. 简单相似度匹配。
7. 仍不确定则不合并，保留独立节点。

第一版不引入 LLM 二次合并判定，避免复杂度过高。

## 5. 置信度策略

### 5.1 节点

节点不强制存 `confidence`。

原因：实体是否存在通常比关系更容易确认，第一版保持简单。

### 5.2 关系

关系保留现有字段：

- `confidence`
- `confidence_score`

取值：

| 值 | 含义 |
| --- | --- |
| `EXTRACTED` | 原文明确表达。 |
| `INFERRED` | 上下文合理推断。 |
| `AMBIGUOUS` | 有歧义，不确定。 |

入库规则：

- `confidence_score < 0.6`：不入库。
- `AMBIGUOUS`：可入库但默认不参与强结构化查询。
- 结构化查询默认只使用 `EXTRACTED` 和高分 `INFERRED`。

## 6. 抽取 Prompt 要求

改造 `KnowledgeGraphService._build_semantic_prompt()`。

LLM 输出格式：

```json
{
  "entities": [
    {
      "id": "实体在文中的名称",
      "canonical_name": "标准名称",
      "label": "Product | Organization | Platform | Technology | Concept | Feature",
      "aliases": ["别名1", "别名2"],
      "description": "一句话说明实体是什么",
      "properties": {
        "url": null,
        "github_url": null,
        "official_site": null,
        "paper_url": null,
        "model_url": null
      }
    }
  ],
  "relationships": [
    {
      "source": "源实体 canonical_name",
      "source_label": "源实体类型",
      "target": "目标实体 canonical_name",
      "target_label": "目标实体类型",
      "type": "DEVELOPED | BASED_ON | USES | SUPPORTS | HAS_FEATURE | SOLVES",
      "evidence_snippet": "原文证据片段",
      "confidence": "EXTRACTED | INFERRED | AMBIGUOUS",
      "confidence_score": 0.0
    }
  ]
}
```

Prompt 必须强调：

- 实体类型只能使用 6 类。
- 关系类型只能使用 6 类。
- URL、时间、指标、组件数量不要作为节点，应放入 `properties`。
- 同一实体多种叫法只输出一个实体，其他名称放入 `aliases`。
- 不输出 `disambiguation`。
- 同名实体如果上下文含义或实体类型不同，不要合并；应输出为不同类型节点。

## 7. 后端改造点

主要文件：

- `backend/app/services/knowledge_graph/service.py`
- `backend/app/schemas/knowledge_graph.py`
- `backend/app/api/v1/endpoints/knowledge_graph.py`

### 7.1 新增常量

```python
DOMAIN_NODE_TYPES = {
    "product",
    "organization",
    "platform",
    "technology",
    "concept",
    "feature",
}

DOMAIN_RELATION_TYPES = {
    "DEVELOPED",
    "BASED_ON",
    "USES",
    "SUPPORTS",
    "HAS_FEATURE",
    "SOLVES",
}
```

### 7.2 新增方法

建议新增：

```python
def _normalize_domain_node_type(self, value: Any) -> str:
    ...


def _normalize_domain_relation_type(self, value: Any) -> Optional[str]:
    ...


def _canonicalize_entity_name(self, name: str, node_type: str) -> str:
    ...


def _resolve_existing_entity_node(self, spec: NodeSpec) -> Optional[KnowledgeGraphNode]:
    ...


def _merge_aliases(self, existing_aliases: list[str], new_names: list[str], canonical_name: str) -> list[str]:
    ...
```

### 7.3 改造 `_extract_semantic_structure()`

需要兼容新格式：

- `entities[].canonical_name` 作为节点标准名。
- `entities[].label` 作为实体类型。
- `entities[].properties` 合入 `metadata`。
- `relationships[]` 替代旧的 `relations[]`。
- 关系类型必须经过 `_normalize_domain_relation_type()`。
- 低置信关系不入库。

### 7.4 改造 `_upsert_nodes()`

写入节点前先查找可合并节点：

- 如果命中已有节点，更新 `label`、`aliases`、`metadata_json`。
- `aliases` 必须保留旧名称和新名称。
- 不创建重复节点。

## 8. 结构化查询能力

新增接口：

```text
POST /api/v1/knowledge-graph/structured-query
```

### 8.1 请求

```json
{
  "question": "帮我找支持 Agent-to-UI 协议，并能解决跨平台的应用",
  "top_k": 10
}
```

### 8.2 内部解析结果

```json
{
  "target_type": "Product",
  "conditions": [
    {
      "relation_type": "BASED_ON",
      "target_type": "Concept",
      "target_terms": ["Agent-to-UI", "A2UI"]
    },
    {
      "relation_type": "SOLVES",
      "target_type": "Feature",
      "target_terms": ["跨平台", "多端UI适配"]
    }
  ]
}
```

### 8.3 查询逻辑

- 找出所有 `product` 节点。
- 按条件检查其出边。
- 每个条件命中一组 Product。
- 多条件取交集。
- 返回产品、命中关系、相关文章。

### 8.4 结构化查询默认过滤

默认参与强查询的关系：

- `confidence = EXTRACTED`
- 或 `confidence = INFERRED and confidence_score >= 0.75`

默认排除：

- `AMBIGUOUS`
- `confidence_score < 0.6`

## 9. 前端改造点

主要文件：

- `frontend/src/components/KnowledgeGraphPanel.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/types/index.ts`

新增“结构化图谱查询”入口：

- 输入自然语言问题。
- 展示解析出的查询条件。
- 展示命中 Product。
- 展示命中的关系路径和证据文章。
- 支持点击结果聚焦到图谱画布。

第一版前端可简单实现，不需要复杂可视化。

## 10. 核心流程

### 10.1 文章解析入图流程

```text
文章入库
  -> 触发知识图谱同步
  -> 读取文章标题、摘要、正文、来源、标签
  -> 构造领域本体 Prompt
  -> LLM 抽取 entities / relationships
  -> 校验实体类型和关系类型
  -> 实体 canonical_name 归一化
  -> 查找已有节点并做 aliases 合并
  -> 过滤低置信关系
  -> 删除该文章旧图谱边
  -> 写入节点和关系
  -> 更新文章同步状态
  -> 重建图谱 snapshot
```

关键规则：

- 实体类型不在 6 类内则丢弃或降级为 `concept`。
- 关系类型不在 6 类内则丢弃。
- 同类型且含义一致的实体直接合并。
- 合并产生的旧名称全部进入 `aliases`。
- 低置信关系不参与入库或不参与强查询。

### 10.2 查询流程

```text
用户输入自然语言问题
  -> LLM/规则解析为结构化查询条件
  -> 对查询词做实体链接，匹配 label / aliases / canonical_name
  -> 按 target_type 找候选节点
  -> 按关系条件过滤候选节点
  -> 多个条件取交集
  -> 收集命中关系、证据片段、相关文章
  -> 可选调用 LLM 生成中文回答
  -> 返回结果给前端
```

示例：

```text
问题：帮我找支持 Agent-to-UI 协议，并能解决跨平台的应用

解析：
目标类型：Product
条件 1：BASED_ON -> Concept: Agent-to-UI / A2UI
条件 2：SOLVES -> Feature: 跨平台 / 多端 UI 适配

执行：
找到同时满足两个条件的 Product，返回 AGenUI。
```

查询规则：

- 优先使用结构化图谱查询。
- 查询词必须匹配 `label`、`aliases` 或 `canonical_name`。
- 强查询默认排除 `AMBIGUOUS` 关系。
- 如果结构化查询无结果，再 fallback 到当前 GraphRAG 问答。

## 11. 开发顺序

### 阶段一：本体约束抽取

1. 新增领域本体常量。
2. 改造 `_build_semantic_prompt()`。
3. 改造 `_extract_semantic_structure()`。
4. 支持新 JSON 格式。
5. 关系类型强校验。

### 阶段二：轻量实体消歧

1. 增加 canonical name 归一化。
2. 增加 aliases 合并。
3. 增加强唯一标识匹配。
4. 改造 `_upsert_nodes()` 避免重复节点。

### 阶段三：结构化查询

1. 新增请求/响应 schema。
2. 新增 service 方法。
3. 新增 API endpoint。
4. 查询结果接入图谱上下文。

### 阶段四：前端入口

1. 新增 API 调用。
2. 新增结构化查询 UI。
3. 结果可跳转图谱节点。

## 12. 验收标准

### 抽取验收

给定 AGenUI 类文章，应抽出：

- `AGenUI` 为 `product`
- `高德` 为 `organization`
- `阿里千问 C 端应用团队` 为 `organization`
- `iOS`、`Android`、`HarmonyOS` 为 `platform`
- `Agent-to-UI` / `A2UI` 为 `concept`
- `多端 UI 适配` 为 `feature`

关系应包括：

- `高德 -[DEVELOPED]-> AGenUI`
- `阿里千问 C 端应用团队 -[DEVELOPED]-> AGenUI`
- `AGenUI -[SUPPORTS]-> iOS`
- `AGenUI -[SUPPORTS]-> Android`
- `AGenUI -[SUPPORTS]-> HarmonyOS`
- `AGenUI -[BASED_ON]-> Agent-to-UI`
- `AGenUI -[SOLVES]-> 多端 UI 适配`

### 消歧验收

以下名称应尽量合并：

- `A2UI`
- `Agent-to-UI`
- `Agent to UI`
- `Google A2UI协议`

合并后：

- 只有一个 `concept` 节点。
- 其他名称进入 `aliases`。

### 查询验收

用户提问：

```text
帮我找支持 Agent-to-UI 协议，并能解决跨平台的应用
```

系统应返回：

- 命中 Product：`AGenUI`
- 命中关系：`BASED_ON -> Agent-to-UI`、`SOLVES -> 多端 UI 适配`
- 返回相关证据文章。

## 13. 不做范围

第一版暂不做：

- Neo4j 迁移。
- 复杂实体合并审计表。
- LLM 二次合并确认。
- 人工审核后台。
- 全量历史实体自动重写。

这些可以作为后续增强。
