# 向量搜索性能：已落地改动与运维说明

生产实测（约 20,448 篇文章，Docker，单 worker uvicorn）：

- `POST /rag/search` 走 sqlite-vec：**1.3–1.6s**（可接受，主要是 query embedding HTTP）
- `GET /rag/stats` 曾 **12.3s**：`get_index_stats()` 用 ORM `join().all()` 把全部 JSON 向量读进内存，且在 async 路由里同步执行，堵住唯一 worker；`RAG.tsx` 每 30s 拉一次
- `article_embeddings=20448`，`vec_embeddings≈18361`，**缺 2087 行**（1024 维，不必重打 embedding）
- 每个 RAG 请求都 `create_ai_analyzer()` + `force_reload`

## 1. 当前架构（未换引擎）

| 项 | 现状 |
|---|---|
| 主库 | SQLite WAL |
| 向量 | `sqlite-vec` `vec0`，余弦，SIMD 穷举（无 HNSW） |
| 双写 | `article_embeddings.embedding`（JSON）+ `vec_embeddings` |
| 粒度 | 一篇文章一个向量 |
| 检索 | 优先 `MATCH`；**2 千篇以上默认拒绝 Python 全表扫描** |

## 2. 已落地（P0 + P1 + P2）

### P0 统计

- `compute_index_stats()` 只用 `COUNT` / `GROUP BY`，不读 `embedding` / `text_content`
- `GET /api/v1/rag/stats` **不创建 AI 客户端**，DB 工作在 `asyncio.to_thread`
- 返回 `vec_index_count`、`vec_missing_count`、`vector_backend`

### P1 回填与拒绝全表扫描

- `POST /api/v1/rag/index/sync-vec`（需登录）：把 JSON 里缺失的 `article_id` 写入 vec0
  - 不调用 embedding API
  - 不 DROP 表
  - 幂等、分批、打进度日志
- sqlite-vec 失败或 vec 为空且已索引 **> 2000** 时返回 **503**，不再静默扫 JSON
- 小规模或 `RAG_ALLOW_PYTHON_FULL_SCAN=1` 才允许 Python 回退（调试）

### P2 缓存与日志

- 进程内缓存 `AIAnalyzer` / embedding client；改 LLM/提供商或还原数据库时 `invalidate_ai_analyzer_cache()`
- query embedding 短 TTL LRU（默认 256 条 / 10 分钟）
- 日志：`search path=sqlite-vec|python|refused embed_ms=… search_ms=…`

## 3. 部署后做一次回填

不需要 migration，也不需要重建 embedding。镜像更新并启动后：

```bash
# 先看缺口
curl -s http://localhost:8000/api/v1/rag/stats

# 登录后回填缺失的 vec0 行（约 2 千条，不打 embedding API）
curl -X POST -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:8000/api/v1/rag/index/sync-vec?batch_size=200"
```

也可在 **系统设置 → RAG 索引 → 同步缺失的 vec0 行**。

预期：`vec_index_count` 接近 `indexed_articles`，`/rag/stats` 从十余秒降到毫秒级，搜索不再因缺行或 stats 堵 worker 而变慢。

## 4. 不要做的事

- 不要用「强制重建所有索引」来补 vec0：那会重打 2 万次 embedding
- 不要 `DROP TABLE vec_embeddings` 除非维度真的错了
- 不要设 `RAG_ALLOW_PYTHON_FULL_SCAN=1` 上生产

## 5. 部署热修（2026-09）

1. **`/index/sync-vec` 被 `{article_id}` 吃掉（422）**  
   静态路由必须写在 `/index/{article_id}` **前面**。

2. **请求 Session 报 `no such module: vec0`**  
   根因：`init_sqlite_vec_table()` 用独立 `sqlite3.connect()` 加载扩展，启动日志因此是绿的；SQLAlchemy QueuePool 在注册 `connect` 监听器之前就被 WAL 占用，`connect` 不会再触发，之后每个 Session 都是 `no such module: vec0`。  
   修复：`_setup_sqlite_vec_loader()` 必须在 `_enable_sqlite_wal()` / 任何 `engine.connect()` **之前**；注册后立刻 `engine.dispose()` 清掉无 vec0 的池连接。checkout / `get_session()` 再补加载作为兜底。  
   `compute_index_stats`：`vec_index_count is not None`（**包括 0**）即视为 sqlite-vec。

## 6. 调试

日志关键字：

- `search path=sqlite-vec embed_ms=… search_ms=…`
- `search path=refused`：应去跑 sync-vec
- `AI analyzer cache invalidated`
- `vec0 回填完成`

环境变量：

| 变量 | 作用 |
|---|---|
| `RAG_ALLOW_PYTHON_FULL_SCAN=1` | 允许全表 JSON 余弦（仅调试） |

## 7. 仍未做（规模再涨再评估）

- 去掉 JSON 双写
- FTS5 混合检索
- 迁 Qdrant / pgvector / HNSW（20k + sqlite-vec 穷举不是主因）
