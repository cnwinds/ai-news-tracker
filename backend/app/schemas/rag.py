"""
RAG相关的 Pydantic 模型
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


class RAGSearchRequest(BaseModel):
    """RAG搜索请求"""
    query: str = Field(..., description="搜索查询文本")
    top_k: int = Field(10, ge=1, le=50, description="返回结果数量")
    sources: Optional[List[str]] = Field(None, description="来源过滤")
    importance: Optional[List[str]] = Field(None, description="重要性过滤")
    time_from: Optional[datetime] = Field(None, description="时间范围开始")
    time_to: Optional[datetime] = Field(None, description="时间范围结束")


class ArticleSearchResult(BaseModel):
    """文章搜索结果"""
    id: int
    title: str
    title_zh: Optional[str] = None
    url: str
    summary: Optional[str] = None
    source: str
    published_at: Optional[str] = None
    importance: Optional[str] = None
    tags: Optional[List[str]] = None
    similarity: float = Field(..., description="相似度分数 (0-1)")


class RAGSearchResponse(BaseModel):
    """RAG搜索响应"""
    query: str
    results: List[ArticleSearchResult]
    total: int


class ConversationMessage(BaseModel):
    """对话消息"""
    role: str = Field(..., description="角色：user 或 assistant")
    content: str = Field(..., description="消息内容")


class RAGQueryRequest(BaseModel):
    """RAG问答请求"""
    question: str = Field(..., description="问题文本")
    top_k: int = Field(5, ge=1, le=10, description="检索的文章数量")
    conversation_history: Optional[List[ConversationMessage]] = Field(
        None, 
        description="对话历史，用于保持上下文连续性"
    )


class RAGQueryResponse(BaseModel):
    """RAG问答响应"""
    question: str
    answer: str
    sources: List[str]
    articles: List[ArticleSearchResult]


class RAGIndexResponse(BaseModel):
    """RAG索引响应"""
    success: bool
    article_id: int
    message: str


class RAGBatchIndexRequest(BaseModel):
    """批量索引请求"""
    article_ids: Optional[List[int]] = Field(None, description="文章ID列表，为空则索引所有未索引的文章")
    batch_size: int = Field(10, ge=1, le=50, description="批处理大小")


class RAGBatchIndexResponse(BaseModel):
    """批量索引响应"""
    total: int
    success: int
    failed: int
    message: str


class RAGStatsResponse(BaseModel):
    """RAG统计响应"""
    total_articles: int
    indexed_articles: int
    unindexed_articles: int
    index_coverage: float = Field(..., description="索引覆盖率 (0-1)")
    source_stats: Dict[str, int]
    vec_index_count: Optional[int] = Field(
        None, description="sqlite-vec vec_embeddings 行数；为 None 表示 vec0 不可用"
    )
    vec_missing_count: Optional[int] = Field(
        None, description="article_embeddings 有、vec_embeddings 没有的行数"
    )
    vector_backend: Optional[str] = Field(
        None, description="预计检索后端：sqlite-vec / python / none / unknown"
    )


class RAGVecSyncResponse(BaseModel):
    """JSON → vec0 回填结果"""
    json_count: int
    vec_count_before: int
    vec_count_after: int
    missing_before: int
    synced: int
    skipped: int
    failed: int
    message: str


