# 向量搜索性能分析与优化计划

面向约 20,448 篇文章时语义搜索变慢的问题。本文只描述**当前代码真实路径**，未实测生产库延迟的结论一律标为假设。

## 1. 当前架构（与代码一致）

### 1.1 存储栈

| 项 | 现状 |
|---|---|
| 主库 | SQLite（WAL、`busy_timeout=30s`、`synchronous=NORMAL`） |
| 向量扩展 | `sqlite-vec`（`requirements.txt` 未钉版本） |
| 距离度量 | `DISTANCE_METRIC=cosine` |
| 索引类型 | `vec0` 虚拟表；**没有 HNSW / IVF**。sqlite-vec 的 KNN 是 SIMD 加速的穷举扫描 |
| 嵌入模型 | 默认 `text-embedding-3-small`，可在设置里换成任意 OpenAI 兼容模型 |
| 维度配置 | `get_embedding_dimension()` 硬编码映射；**建表维度与真实 API 返回维度可能不一致** |
| 粒度 | **一篇文章一个向量**，没有 chunk |
| 双写 | `article_embeddings.embedding`（JSON 浮点数组）+ `vec_embeddings.embedding`（vec0 二进制） |

`article_embeddings` 还存了完整 `text_content`（标题 + 摘要 + 正文前 5000/8000 字）。没有 chunk 表，也没有 FTS5 / BM25。

`vec0` 表结构（启动时按配置维度创建）：

```sql
CREATE VIRTUAL TABLE vec_embeddings USING vec0(
    article_id INTEGER PRIMARY KEY,
    embedding float[{dimension}] DISTANCE_METRIC=cosine
);
```

辅助列只有 `article_id`。来源 / 重要性 / 时间过滤必须 JOIN `articles`。

### 1.2 查询路径

```
POST /api/v1/rag/search
  → get_rag_service()
      → create_ai_analyzer()
          → settings.load_settings_from_db(force_reload=True)
          → 新建 OpenAI LLM / Embedding 客户端
      → RAGService.__init__
          → SELECT 1 FROM vec_embeddings LIMIT 1   # 探测 vec0
  → asyncio.to_thread(search_articles)
      → embedding API（每次查询都要打）
      → sqlite-vec MATCH   或   Python 全表余弦
```

问答 `POST /api/v1/rag/query` 和流式 `/query/stream` 复用同一条 `search_articles`。

**sqlite-vec 路径**（`_search_with_sqlite_vec`）：

1. `SELECT COUNT(*) FROM vec_embeddings`，为 0 则回退 Python。
2. `ArticleEmbedding.first()`，把 JSON 向量读出来比对维度。
3. `MATCH` + `k = max(top_k * 3, 20)`，再 `JOIN articles`，再拼 `source` / `importance` / `published_at` 过滤。
4. 应用层按 `article_id` 去重，收藏 +0.2 分，截断 `top_k`。
5. **任何异常都静默回退 Python**。

**Python 回退路径**（`_search_with_python`）：

1. `query(ArticleEmbedding, Article).join(...).all()`，把**全部**已索引行拉进内存。
2. 反序列化每条 JSON 向量，用 numpy 算余弦。
3. 排序后取 `top_k`。

过滤在这条路径上是 **SQL 预过滤**（先缩小集合再算相似度）。sqlite-vec 路径是 **先 ANN/穷举取 k，再 SQL 后过滤**。

### 1.3 索引文本与模型

`_combine_article_text()` 拼一篇文章：

- 标题、中文标题
- `summary` 或 `detailed_summary`
- 正文前 5000 字（有摘要）或 8000 字（无摘要）
- 标签、来源

没有按段落切分。检索时只对 query 再 embed 一次，**不会**在查询时重 embed 文章。

维度映射（`backend/app/db/__init__.py`）：

| 模型名 | 代码里的维度 | 备注 |
|---|---|---|
| `text-embedding-3-small` | **1024** | OpenAI 官方默认是 **1536**，且代码调用 API 时**没有**传 `dimensions=` |
| `text-embedding-3-large` | 3072 | 与 OpenAI 默认一致 |
| `text-embedding-v3` | 1536 | 常见于国内兼容接口 |
| `text-embedding-v4` | 1024 | 常见于国内兼容接口 |

生成向量时：

```python
self.embedding_client.embeddings.create(model=self.embedding_model, input=text.strip())
```

维度完全取决于提供商实际返回值，**不是**上面这张表。这张表只用来建 `vec0`。

### 1.4 过滤

前端 `RAGSearch` 可传来源、重要性、时间范围。`k` 固定为 `max(top_k*3, 20)`，与过滤选择度无关。

过滤越严，sqlite-vec 越容易先取出 20～150 个近邻、再被滤掉大部分（结果变少，不一定变慢）。过滤 SQL 若让 `MATCH` 报错，会整段掉进 Python 全表扫描（变慢）。

### 1.5 连接与池

- `create_engine(sqlite, check_same_thread=False, timeout=30)`，未改 `poolclass`，SQLAlchemy 默认 QueuePool。
- 每次请求 `get_session()` 取一个 Session。
- 没有专用向量连接池，也没有查询结果缓存。

对 2 万级 SQLite + WAL，池本身不太可能是主因。

---

## 2. 2 万篇文章下的瓶颈（按可能性）

### P0 — 静默掉进 Python 全表扫描（高可能性，未在用户库上证明）

20k 条 JSON 向量大约：

- 1024 维：每条 ~10–15KB 文本 → 合计 **200–300MB**
- 1536 维：合计 **300–400MB**

再加上 ORM 默认把 `articles.content` 和 `article_embeddings.text_content` 一起加载，单次回退很容易到 **10–60s+**。

会触发回退的代码路径：

1. `vec_embeddings` 为空（`COUNT(*) == 0`）。
2. `vec0` 探测失败（扩展没加载、SQLite &lt; 3.41）。
3. `MATCH` / JOIN / 过滤 SQL 抛错。
4. 查询向量维度与 `article_embeddings` 样本不一致。

**空 `vec0` 是最危险的。** `init_sqlite_vec_table()` 在维度不匹配时会 `DROP` 并重建空表，只打日志「需要重新索引」，**不会**从 JSON 回填。之后每一次搜索都走 Python。README 还把「SQLite 过低 → Python 回退」写成可忽略，在 2 万篇时这已经不能忽略。

### P0 — `/rag/stats` 全表加载（已由代码证实）

`get_index_stats()` 原来为了按来源计数，会 `join` 加载全部 `ArticleEmbedding` + `Article`。

RAG 页每 30 秒拉一次统计。等于定期把全部 JSON 向量和文章正文读进内存，并和搜索抢 SQLite。

### P1 — 每次搜索都打 Embedding API + 重建客户端（高可能性）

`search_articles()` 对 query 必打一次 HTTP。国内代理常见 **200ms–2s+**。

更糟的是 `get_rag_service()` → `create_ai_analyzer()` → `force_reload=True` 重载全部设置，再 `OpenAI()`。统计接口以前也走这条路径。

即便 sqlite-vec 只要 20ms，用户仍会觉得「搜索很慢」。

### P1 — 维度映射可能把 `vec0` 建错（假设）

若真实向量是 1536 维，而 `vec0` 建成 `float[1024]`：

- 写入 `vec_embeddings` 失败（只打 warning）
- JSON 表正常，vec0 空或残缺
- 搜索回退 Python

反之亦然。需要看日志里的「同步向量到vec0表失败」和 `article_embeddings` 实际长度。

### P2 — 双写 JSON 导致库膨胀

20k × (JSON 向量 + 索引原文) 会把 SQLite 撑到数百 MB～数 GB。WAL checkpoint、备份、普通文章列表也会变慢。这不是单次 `MATCH` 的主因，但是规模税。

### P2 — sqlite-vec 后过滤的 `k` 过小（质量，不是速度）

`k = max(top_k*3, 20)` 在「只看某一个源 + 某一周」时可能不够。用户会感觉「结果少/不准」，不是「慢」。

### 可以排除或降级的猜测

| 猜测 | 结论 |
|---|---|
| 缺 HNSW 所以 20k 必慢 | **不太像主因**。sqlite-vec 穷举 20k×1024 通常是几十毫秒。只有掉进 Python / JSON 全表时才会随 N 线性恶化 |
| 查询时重新 embed 全部文章 | **否**。只 embed query |
| N+1 SQL 打每篇文章 | **否**。sqlite-vec 一条 JOIN；Python 路径是一次 `all()` 超级大查询 |
| 把全部向量常驻进程内存做 FAISS | **否**。没有 FAISS / 内存索引 |

---

## 3. 优化选项（只谈本栈）

按「先确认路径，再修回归，最后换引擎」排。工作量是相对改动面，不是工期。

### P0.1 先确认实际走了哪条路径（建议立刻做）

在日志里搜：

- `搜索完成（使用sqlite-vec）`
- `搜索完成（使用Python计算）`
- `sqlite-vec搜索失败` / `vec_embeddings表为空` / `回退到Python计算`
- `同步向量到vec0表失败` / `vec0表维度不匹配`

对比 `article_embeddings` 行数和 `vec_embeddings` 行数。若后者为 0 或远小于前者，P0 假设成立。

`GET /api/v1/rag/stats` 现已返回 `vec_index_count` 和 `vector_backend`，可直接看。

**工作量**：读日志 / 看 stats。**收益**：决定后面改什么。

### P0.2 禁止在 2 万篇时静默全表扫描

- 回退时打 **error** 级别日志，带异常类型和 SQL。
- `vec_embeddings` 明显少于 `article_embeddings` 时，**不要**自动扫 JSON；返回明确错误或走「从 JSON 回填 vec0」的后台任务。
- 提供 `POST /rag/index/sync-vec`：只把已有 JSON 写入 vec0，**不要**重新打 embedding API。

**工作量**：小。**收益**：若当前是空 vec0，同步后搜索应从数十秒降到「embedding 网络延迟 + 几十毫秒 SQL」。**风险**：低。

### P0.3 统计接口改成聚合 SQL（本 PR 已做）

用 `COUNT` / `GROUP BY`，不再 `all()` 加载向量。`/rag/stats` 不再创建 AI 客户端。

**工作量**：已完成。**收益**：打开 RAG 页不再每 30 秒扫全库。**风险**：极低。

### P0.4 Python 回退不要加载 `content` / `text_content`（本 PR 已做）

`load_only` 只要算相似度和展示需要的列。这是兜底，不能当主方案。

**工作量**：已完成。**收益**：回退仍是 O(N)，但少读几百 MB 正文。**风险**：极低。

### P1.1 每次搜索不要 `force_reload` + 新建客户端

缓存 `AIAnalyzer` / embedding client，设置变更时再失效。

**工作量**：小。**收益**：少一次全量读配置 + 两次 SDK 初始化。**风险**：中（要处理好设置热更新）。

### P1.2 查询向量短缓存

对规范化后的 query 做内存 LRU（TTL 5–15 分钟）。重复搜同一句话可跳过 embedding HTTP。

**工作量**：小。**收益**：重复查询明显快。**风险**：低；模型更换时要清空。

### P1.3 用真实维度建 `vec0`，不要猜

以一次 `generate_embedding("test")` 的 `len(embedding)` 为准，或把维度写入 `article_embeddings` / 设置表。修正 `text-embedding-3-small → 1024` 之前必须先量真实长度。

**工作量**：小。**收益**：避免空 vec0。**风险**：中（改错维度会再次 DROP 表）。

### P1.4 sqlite-vec 查询去掉每请求的 `COUNT(*)` 和 JSON 样本

维度启动时缓存。`COUNT(*)` 只在同步/重建后更新。

**工作量**：小。**收益**：每次搜索少两次多余往返。20k 上是锦上添花。

### P1.5 过滤下推到 vec0 分区/辅助列

sqlite-vec 支持 `+source TEXT` 这类辅助列，或按时间分区。过滤可以在 KNN 前做。

同时把 `k` 改成随过滤选择度变化（例如 `k = min(indexed, max(top_k * 10, 200))`），或改成「先 SQL 选出候选 id，再只在候选上 MATCH」（若当前 sqlite-vec 版本支持）。

**工作量**：中。**收益**：严过滤时结果更稳；对无过滤的全库搜索帮助不大。**风险**：中（要重建 vec0 并回填）。

### P2.1 去掉 JSON 双写，或改 BLOB

vec0 稳定后，`article_embeddings.embedding` 可改为不存、或只存 float32 BLOB。`text_content` 可截断或不存（原文已在 `articles`）。

**工作量**：中。**收益**：库文件显著变小，降低回退杀伤力。**风险**：中（失去「无扩展时的纯 Python 重建」）。

### P2.2 SQLite FTS5 混合检索

对标题/摘要建 FTS5，与向量分数做 RRF。改善专有名词（代码里已提到 Nemotron 这类词）。

**工作量**：中。**收益**：相关性，不是 20k 规模下的主速度项。**风险**：低。

### P2.3 sqlite-vec int8 量化

体积和扫描带宽约降为 1/4。20k 上速度收益有限。

**工作量**：中。**收益**：低～中。**风险**：中（精度、重建）。

### 不建议现在做

| 选项 | 原因 |
|---|---|
| 上 Qdrant / pgvector / Chroma / FAISS | 20k 不是 sqlite-vec 穷举的上限。先把回退和空 vec0 修掉。到 10 万+ 或要过滤型 ANN 再迁 |
| 现在就上 HNSW | 本栈没有现成 HNSW。sqlite-vec 也不提供 |
| 按 chunk 切文章 | 改善召回，但行数变多，应在主路径稳定之后 |
| 为速度换更小 embedding 模型 | 先确认瓶颈是 SQL 还是 HTTP |

---

## 4. 建议的下一步（请勾选批准后再改）

**第一步（诊断，建议先做）：**

1. 打开 RAG 页或调用 `GET /api/v1/rag/stats`，看 `indexed_articles` vs `vec_index_count`、`vector_backend`。
2. 搜一次，在日志里看 `search path=` / `elapsed=`，以及是否出现 `Python`。

**第二步（若 vec0 空或缺行，优先）：**

3. 实现「JSON → vec0」同步，不重新调用 embedding API。
4. 回退改为显式失败或只在索引量很小（例如 &lt; 2000）时允许。
5. 用一次真实 embedding 长度修复维度映射，避免再次 DROP 空表。

**第三步（即便 vec0 正常也值得做）：**

6. 缓存 embedding 客户端，去掉每次搜索的 `force_reload`。
7. query embedding LRU。
8. 有过滤时调整 `k` / 预过滤。

**第四步（规模继续涨再评估）：**

9. 去掉 JSON 双写。
10. FTS5 混合检索。
11. 到 10 万+ 再评估独立向量库。

---

## 5. 本 PR 已落地的小改动

只改了「明显正确、风险极低」的部分，没有换存储引擎。

1. `get_index_stats()` 改为 `COUNT` + `GROUP BY`，并返回 `vec_index_count` / `vector_backend`。
2. `GET /api/v1/rag/stats` 不再创建 AI 客户端。
3. Python 回退使用 `load_only`，不再加载 `content` / `text_content`。
4. 搜索日志带上路径和耗时，便于确认 P0 假设。
