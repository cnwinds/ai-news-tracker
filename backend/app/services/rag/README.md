# RAG功能使用说明

## 概述

RAG（Retrieval-Augmented Generation）功能允许您对收录的文章进行语义搜索和智能问答。

## 功能特性

1. **文章向量索引**：将文章内容转换为向量并存储
2. **语义搜索**：基于向量相似度搜索相关文章
3. **智能问答**：基于检索到的文章内容回答问题

## API端点

### 1. 语义搜索

```http
POST /api/v1/rag/search
Content-Type: application/json

{
  "query": "GPT-4的最新进展",
  "top_k": 10,
  "sources": ["OpenAI Blog"],
  "importance": ["high", "medium"]
}
```

### 2. 智能问答

```http
POST /api/v1/rag/query
Content-Type: application/json

{
  "question": "最近有哪些关于大语言模型的重要突破？",
  "top_k": 5
}
```

### 3. 索引单篇文章

```http
POST /api/v1/rag/index/{article_id}
```

### 4. 批量索引文章

```http
POST /api/v1/rag/index/batch
Content-Type: application/json

{
  "article_ids": [1, 2, 3],
  "batch_size": 10
}
```

### 5. 索引所有未索引的文章

```http
POST /api/v1/rag/index/all?batch_size=10
```

### 6. 获取索引统计

```http
GET /api/v1/rag/stats
```

## 使用流程

1. **首次使用**：索引现有文章
   ```bash
   # 通过API索引所有文章
   curl -X POST http://localhost:8000/api/v1/rag/index/all
   ```

2. **自动索引**：新采集的文章会在采集完成后自动索引（如果启用了AI分析）

3. **搜索和问答**：使用上述API端点进行搜索和问答

## 技术实现

- **嵌入模型**：OpenAI text-embedding-3-small
- **向量存储**：SQLite数据库（JSON格式存储向量）
- **相似度计算**：余弦相似度（使用numpy）

## 注意事项

1. 索引需要调用OpenAI Embeddings API，会产生费用
2. 首次索引大量文章可能需要较长时间
3. 确保已配置`OPENAI_API_KEY`环境变量

