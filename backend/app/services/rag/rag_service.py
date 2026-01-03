"""
RAG服务 - 实现文章向量索引、搜索和问答功能
"""
import json
import logging
import numpy as np
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from backend.app.db.models import Article, ArticleEmbedding
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer

logger = logging.getLogger(__name__)


class RAGService:
    """RAG服务类"""

    def __init__(self, ai_analyzer: AIAnalyzer, db: Session):
        """
        初始化RAG服务

        Args:
            ai_analyzer: AI分析器实例（用于生成嵌入向量）
            db: 数据库会话
        """
        self.ai_analyzer = ai_analyzer
        self.db = db
        self._init_vector_extension()

    def _init_vector_extension(self):
        """初始化sqlite-vss扩展（如果可用）"""
        try:
            # 尝试加载sqlite-vss扩展
            # 注意：这需要在SQLite连接上执行，而不是在SQLAlchemy会话上
            # 我们将在实际使用时处理
            logger.info("✅ RAG服务初始化完成（使用Python向量计算）")
        except Exception as e:
            logger.warning(f"⚠️  sqlite-vss扩展不可用，将使用Python向量计算: {e}")

    def _combine_article_text(self, article: Article) -> str:
        """
        组合文章的所有字段为索引文本

        Args:
            article: 文章对象

        Returns:
            组合后的文本
        """
        parts = []
        
        # 标题
        if article.title:
            parts.append(f"标题: {article.title}")
        
        # 中文标题
        if article.title_zh:
            parts.append(f"中文标题: {article.title_zh}")
        
        # 摘要
        if article.summary:
            parts.append(f"摘要: {article.summary}")
        
        # 内容（截取前5000字符以避免过长）
        if article.content:
            content_preview = article.content[:5000]
            parts.append(f"内容: {content_preview}")
        
        # 关键点
        if article.key_points:
            if isinstance(article.key_points, list):
                key_points_str = "、".join(article.key_points)
                parts.append(f"关键点: {key_points_str}")
        
        # 主题
        if article.topics:
            if isinstance(article.topics, list):
                topics_str = "、".join(article.topics)
                parts.append(f"主题: {topics_str}")
        
        # 标签
        if article.tags:
            if isinstance(article.tags, list):
                tags_str = "、".join(article.tags)
                parts.append(f"标签: {tags_str}")
        
        # 来源
        if article.source:
            parts.append(f"来源: {article.source}")
        
        combined_text = "\n\n".join(parts)
        return combined_text if combined_text.strip() else ""

    def generate_embedding(self, text: str) -> List[float]:
        """
        生成文本的嵌入向量

        Args:
            text: 要生成嵌入向量的文本

        Returns:
            嵌入向量列表
        """
        if not text or not text.strip():
            logger.warning("⚠️  生成嵌入向量时文本为空")
            return []
        
        return self.ai_analyzer.generate_embedding(text)

    def index_article(self, article: Article) -> bool:
        """
        索引单篇文章

        Args:
            article: 文章对象

        Returns:
            是否成功
        """
        try:
            # 检查是否已索引
            existing = self.db.query(ArticleEmbedding).filter(
                ArticleEmbedding.article_id == article.id
            ).first()
            
            if existing:
                logger.debug(f"文章 {article.id} 已存在索引，将更新")
            
            # 生成索引文本
            text_content = self._combine_article_text(article)
            if not text_content.strip():
                logger.warning(f"⚠️  文章 {article.id} 没有可索引的内容")
                return False
            
            # 生成嵌入向量
            logger.info(f"📝 正在为文章 {article.id} 生成嵌入向量...")
            embedding = self.generate_embedding(text_content)
            
            if not embedding:
                logger.error(f"❌ 文章 {article.id} 嵌入向量生成失败")
                return False
            
            # 保存或更新
            if existing:
                existing.embedding = embedding
                existing.text_content = text_content
                existing.embedding_model = self.ai_analyzer.embedding_model
                existing.updated_at = datetime.now()
            else:
                embedding_obj = ArticleEmbedding(
                    article_id=article.id,
                    embedding=embedding,
                    text_content=text_content,
                    embedding_model=self.ai_analyzer.embedding_model
                )
                self.db.add(embedding_obj)
            
            self.db.commit()
            logger.info(f"✅ 文章 {article.id} 索引成功")
            return True
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"❌ 文章 {article.id} 索引失败: {e}")
            return False

    def index_articles_batch(self, articles: List[Article], batch_size: int = 10) -> Dict[str, Any]:
        """
        批量索引文章

        Args:
            articles: 文章列表
            batch_size: 批处理大小

        Returns:
            统计信息
        """
        total = len(articles)
        success_count = 0
        fail_count = 0
        
        logger.info(f"🚀 开始批量索引 {total} 篇文章...")
        
        for i, article in enumerate(articles, 1):
            try:
                if self.index_article(article):
                    success_count += 1
                else:
                    fail_count += 1
                
                if i % batch_size == 0:
                    logger.info(f"📊 进度: {i}/{total} (成功: {success_count}, 失败: {fail_count})")
                    
            except Exception as e:
                logger.error(f"❌ 批量索引文章 {article.id} 时出错: {e}")
                fail_count += 1
        
        logger.info(f"✅ 批量索引完成: 总计 {total}, 成功 {success_count}, 失败 {fail_count}")
        
        return {
            "total": total,
            "success": success_count,
            "failed": fail_count
        }

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """
        计算两个向量的余弦相似度

        Args:
            vec1: 向量1
            vec2: 向量2

        Returns:
            相似度分数 (0-1)
        """
        try:
            v1 = np.array(vec1)
            v2 = np.array(vec2)
            
            dot_product = np.dot(v1, v2)
            norm1 = np.linalg.norm(v1)
            norm2 = np.linalg.norm(v2)
            
            if norm1 == 0 or norm2 == 0:
                return 0.0
            
            similarity = dot_product / (norm1 * norm2)
            return float(similarity)
        except Exception as e:
            logger.error(f"❌ 计算余弦相似度失败: {e}")
            return 0.0

    def search_articles(
        self,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        语义搜索文章

        Args:
            query: 查询文本
            top_k: 返回前k个结果
            filters: 过滤条件（sources, importance, time_range等）

        Returns:
            搜索结果列表，每个结果包含文章信息和相似度分数
        """
        try:
            # 生成查询向量
            logger.info(f"🔍 正在搜索: {query[:50]}...")
            query_embedding = self.generate_embedding(query)
            
            if not query_embedding:
                logger.error("❌ 查询向量生成失败")
                return []
            
            # 获取所有已索引的文章嵌入
            query_obj = self.db.query(ArticleEmbedding, Article).join(
                Article, ArticleEmbedding.article_id == Article.id
            )
            
            # 应用过滤条件
            if filters:
                if filters.get("sources"):
                    query_obj = query_obj.filter(Article.source.in_(filters["sources"]))
                
                if filters.get("importance"):
                    query_obj = query_obj.filter(Article.importance.in_(filters["importance"]))
                
                if filters.get("time_from"):
                    query_obj = query_obj.filter(Article.published_at >= filters["time_from"])
                
                if filters.get("time_to"):
                    query_obj = query_obj.filter(Article.published_at <= filters["time_to"])
            
            # 获取所有匹配的文章嵌入
            embeddings = query_obj.all()
            
            if not embeddings:
                logger.warning("⚠️  没有找到已索引的文章")
                return []
            
            # 计算相似度
            results = []
            for embedding_obj, article in embeddings:
                similarity = self._cosine_similarity(query_embedding, embedding_obj.embedding)
                results.append({
                    "article": article,
                    "similarity": similarity,
                    "embedding_id": embedding_obj.id
                })
            
            # 按相似度排序
            results.sort(key=lambda x: x["similarity"], reverse=True)
            
            # 返回top_k
            top_results = results[:top_k]
            
            # 转换为字典格式
            search_results = []
            for result in top_results:
                article = result["article"]
                search_results.append({
                    "id": article.id,
                    "title": article.title,
                    "title_zh": article.title_zh,
                    "url": article.url,
                    "summary": article.summary,
                    "source": article.source,
                    "published_at": article.published_at.isoformat() if article.published_at else None,
                    "importance": article.importance,
                    "topics": article.topics,
                    "tags": article.tags,
                    "similarity": result["similarity"]
                })
            
            logger.info(f"✅ 搜索完成，找到 {len(search_results)} 个结果")
            return search_results
            
        except Exception as e:
            logger.error(f"❌ 搜索失败: {e}")
            return []

    def query_articles(self, question: str, top_k: int = 5) -> Dict[str, Any]:
        """
        RAG问答：基于检索到的文章回答问题

        Args:
            question: 问题文本
            top_k: 检索的文章数量

        Returns:
            包含答案和引用文章的字典
        """
        try:
            # 检索相关文章
            relevant_articles = self.search_articles(question, top_k=top_k)
            
            if not relevant_articles:
                return {
                    "answer": "抱歉，没有找到相关的文章来回答您的问题。",
                    "sources": [],
                    "articles": []
                }
            
            # 构建上下文
            context_parts = []
            for i, article_info in enumerate(relevant_articles, 1):
                article_text = f"""
文章 {i}:
标题: {article_info['title']}
"""
                if article_info.get('title_zh'):
                    article_text += f"中文标题: {article_info['title_zh']}\n"
                if article_info.get('summary'):
                    article_text += f"摘要: {article_info['summary']}\n"
                if article_info.get('topics'):
                    article_text += f"主题: {', '.join(article_info['topics'])}\n"
                article_text += f"来源: {article_info['source']}\n"
                article_text += f"相似度: {article_info['similarity']:.3f}\n"
                
                context_parts.append(article_text)
            
            context = "\n---\n".join(context_parts)
            
            # 构建提示词
            prompt = f"""基于以下文章内容，回答用户的问题。请使用中文回答，并引用具体的文章。

相关文章：
{context}

用户问题：{question}

请提供详细、准确的答案，并在回答中引用相关的文章。如果文章中没有足够的信息来回答问题，请说明。"""

            # 调用LLM生成答案
            logger.info(f"🤖 正在生成答案...")
            response = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的AI新闻助手，擅长基于提供的文章内容回答问题。请使用中文回答，并准确引用文章来源。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=2000,
            )
            
            answer = response.choices[0].message.content.strip()
            
            return {
                "answer": answer,
                "sources": [article["source"] for article in relevant_articles],
                "articles": relevant_articles
            }
            
        except Exception as e:
            logger.error(f"❌ 问答失败: {e}")
            return {
                "answer": f"抱歉，生成答案时出现错误: {str(e)}",
                "sources": [],
                "articles": []
            }

    def get_index_stats(self) -> Dict[str, Any]:
        """
        获取索引统计信息

        Returns:
            统计信息字典
        """
        try:
            total_articles = self.db.query(Article).count()
            indexed_articles = self.db.query(ArticleEmbedding).count()
            unindexed_articles = total_articles - indexed_articles
            
            # 按来源统计
            source_stats = {}
            embeddings = self.db.query(ArticleEmbedding, Article).join(
                Article, ArticleEmbedding.article_id == Article.id
            ).all()
            
            for embedding_obj, article in embeddings:
                source = article.source
                if source not in source_stats:
                    source_stats[source] = 0
                source_stats[source] += 1
            
            return {
                "total_articles": total_articles,
                "indexed_articles": indexed_articles,
                "unindexed_articles": unindexed_articles,
                "index_coverage": indexed_articles / total_articles if total_articles > 0 else 0.0,
                "source_stats": source_stats
            }
        except Exception as e:
            logger.error(f"❌ 获取索引统计失败: {e}")
            return {
                "total_articles": 0,
                "indexed_articles": 0,
                "unindexed_articles": 0,
                "index_coverage": 0.0,
                "source_stats": {}
            }

