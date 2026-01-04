"""
RAG服务 - 实现文章向量索引、搜索和问答功能
"""
import json
import logging
import numpy as np
import struct
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, text
from sqlalchemy.engine import Connection

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
        self._use_sqlite_vec = self._check_sqlite_vec_available()

    def _check_sqlite_vec_available(self) -> bool:
        """检查sqlite-vec扩展是否可用"""
        try:
            # 尝试查询vec0虚拟表
            result = self.db.execute(text("SELECT 1 FROM vec_embeddings LIMIT 1"))
            result.fetchone()
            logger.debug("✅ sqlite-vec扩展可用，将使用SQL向量搜索")
            return True
        except Exception as e:
            logger.debug(f"ℹ️  sqlite-vec扩展不可用，将使用Python向量计算: {e}")
            return False

    def _vector_to_blob(self, vector: List[float]) -> bytes:
        """将向量转换为BLOB格式（sqlite-vec需要）"""
        # sqlite-vec期望的格式：浮点数数组（小端序）
        return struct.pack(f'{len(vector)}f', *vector)

    def _vector_to_match_string(self, vector: List[float]) -> str:
        """将向量转换为MATCH操作符需要的字符串格式"""
        # sqlite-vec的MATCH操作符需要JSON数组格式的字符串
        return json.dumps(vector)

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
        
        # 内容（截取前2000字符，约2000 tokens，符合最佳实践256-512 tokens的4倍范围）
        # 如果已有摘要，内容作为补充信息，不需要太长
        if article.content:
            # 优先使用摘要，如果摘要存在，内容只取前2000字符作为补充
            # 如果摘要不存在，则取前3000字符
            max_content_length = 2000 if article.summary else 3000
            content_preview = article.content[:max_content_length]
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
            
            # 如果sqlite-vec可用，同步到vec0虚拟表
            if self._use_sqlite_vec:
                try:
                    # sqlite-vec的vec0表需要存储浮点数数组（BLOB格式）
                    vector_blob = self._vector_to_blob(embedding)
                    self.db.execute(
                        text("""
                            INSERT OR REPLACE INTO vec_embeddings (article_id, embedding)
                            VALUES (:article_id, :embedding)
                        """),
                        {"article_id": article.id, "embedding": vector_blob}
                    )
                    self.db.commit()
                except Exception as e:
                    logger.warning(f"⚠️  同步向量到vec0表失败: {e}")
            
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
            
            # 如果sqlite-vec可用，使用SQL向量搜索
            if self._use_sqlite_vec:
                return self._search_with_sqlite_vec(query_embedding, top_k, filters)
            else:
                # 回退到Python向量计算
                return self._search_with_python(query_embedding, top_k, filters)
            
        except Exception as e:
            logger.error(f"❌ 搜索失败: {e}")
            return []

    def _search_with_sqlite_vec(
        self,
        query_embedding: List[float],
        top_k: int,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """使用sqlite-vec进行向量搜索"""
        try:
            # 检查vec_embeddings表是否有数据
            vec_count = self.db.execute(text("SELECT COUNT(*) FROM vec_embeddings")).scalar()
            logger.debug(f"vec_embeddings表中有 {vec_count} 条记录")
            if vec_count == 0:
                logger.warning("⚠️  vec_embeddings表为空，回退到Python计算")
                return self._search_with_python(query_embedding, top_k, filters)
            
            # 检查查询向量维度是否与数据库中存储的向量维度匹配
            # 从article_embeddings表获取一个样本向量来检查维度
            query_dim = len(query_embedding)
            sample_embedding = self.db.query(ArticleEmbedding).first()
            if sample_embedding and sample_embedding.embedding:
                stored_dim = len(sample_embedding.embedding)
                logger.debug(f"查询向量维度: {query_dim}, 存储向量维度: {stored_dim}")
                if query_dim != stored_dim:
                    logger.warning(
                        f"⚠️  向量维度不匹配：查询向量维度 {query_dim}，"
                        f"存储向量维度 {stored_dim}，回退到Python计算"
                    )
                    return self._search_with_python(query_embedding, top_k, filters)
            else:
                logger.warning("⚠️  未找到已索引的文章向量，回退到Python计算")
                return self._search_with_python(query_embedding, top_k, filters)
            
            # sqlite-vec使用MATCH操作符，需要JSON数组格式的字符串
            # 或者可以直接使用BLOB格式
            query_vector_str = self._vector_to_match_string(query_embedding)
            
            # 构建基础查询 - 使用MATCH操作符
            # vec0 的 MATCH 需要明确指定 k 参数：MATCH ? AND k = 10
            # 注意：k 参数必须大于等于 top_k，我们使用 top_k * 2 以确保有足够的结果用于过滤
            # k 参数必须直接写在 SQL 中，不能作为参数绑定
            k_value = max(top_k * 2, 10)  # 至少返回 10 个结果
            
            # 构建基础查询
            sql = f"""
                SELECT 
                    v.article_id,
                    distance,
                    a.id, a.title, a.title_zh, a.url, a.summary, a.source,
                    a.published_at, a.importance, a.topics, a.tags
                FROM vec_embeddings v
                JOIN articles a ON v.article_id = a.id
                WHERE v.embedding MATCH :query_vector AND k = {k_value}
            """
            
            params = {
                "query_vector": query_vector_str
            }
            
            # 添加过滤条件
            if filters:
                conditions = []
                if filters.get("sources"):
                    placeholders = ",".join([f":source_{i}" for i in range(len(filters["sources"]))])
                    conditions.append(f"a.source IN ({placeholders})")
                    for i, source in enumerate(filters["sources"]):
                        params[f"source_{i}"] = source
                
                if filters.get("importance"):
                    placeholders = ",".join([f":importance_{i}" for i in range(len(filters["importance"]))])
                    conditions.append(f"a.importance IN ({placeholders})")
                    for i, imp in enumerate(filters["importance"]):
                        params[f"importance_{i}"] = imp
                
                if filters.get("time_from"):
                    conditions.append("a.published_at >= :time_from")
                    params["time_from"] = filters["time_from"]
                
                if filters.get("time_to"):
                    conditions.append("a.published_at <= :time_to")
                    params["time_to"] = filters["time_to"]
                
                if conditions:
                    sql += " AND " + " AND ".join(conditions)
            
            # 最后限制返回的结果数量（k 已经限制了 KNN 结果，这里再限制最终返回数量）
            sql += f" ORDER BY distance LIMIT {top_k}"
            
            # 执行查询
            result = self.db.execute(text(sql), params)
            rows = result.fetchall()
            
            # 转换为字典格式
            search_results = []
            for row in rows:
                # sqlite-vec返回的distance是欧氏距离，需要转换为相似度
                # 相似度 = 1 / (1 + distance)
                distance = float(row[1]) if row[1] is not None else float('inf')
                similarity = 1.0 / (1.0 + distance) if distance < float('inf') else 0.0
                
                # 处理 published_at：可能是 datetime 对象或字符串
                published_at = row[8]
                if published_at:
                    if isinstance(published_at, datetime):
                        published_at_str = published_at.isoformat()
                    elif isinstance(published_at, str):
                        published_at_str = published_at
                    else:
                        published_at_str = str(published_at)
                else:
                    published_at_str = None
                
                # 处理 topics：可能是列表或 JSON 字符串
                topics = row[10]
                if topics:
                    if isinstance(topics, str):
                        try:
                            topics = json.loads(topics)
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(f"无法解析 topics JSON: {topics}")
                            topics = []
                    elif not isinstance(topics, list):
                        topics = []
                else:
                    topics = []
                
                # 处理 tags：可能是列表或 JSON 字符串
                tags = row[11]
                if tags:
                    if isinstance(tags, str):
                        try:
                            tags = json.loads(tags)
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(f"无法解析 tags JSON: {tags}")
                            tags = []
                    elif not isinstance(tags, list):
                        tags = []
                else:
                    tags = []
                
                search_results.append({
                    "id": row[2],
                    "title": row[3],
                    "title_zh": row[4],
                    "url": row[5],
                    "summary": row[6],
                    "source": row[7],
                    "published_at": published_at_str,
                    "importance": row[9],
                    "topics": topics,
                    "tags": tags,
                    "similarity": similarity
                })
            
            # 去重：按文章ID去重，保留相似度最高的记录
            seen_article_ids = {}
            deduplicated_results = []
            for result in search_results:
                article_id = result["id"]
                if article_id not in seen_article_ids:
                    seen_article_ids[article_id] = result
                    deduplicated_results.append(result)
                else:
                    # 如果已存在，比较相似度，保留更高的
                    existing = seen_article_ids[article_id]
                    if result["similarity"] > existing["similarity"]:
                        # 替换为相似度更高的记录
                        index = deduplicated_results.index(existing)
                        deduplicated_results[index] = result
                        seen_article_ids[article_id] = result
            
            # 按相似度重新排序（去重后可能顺序改变）
            deduplicated_results.sort(key=lambda x: x["similarity"], reverse=True)
            
            # 限制返回数量
            final_results = deduplicated_results[:top_k]
            
            logger.info(f"✅ 搜索完成（使用sqlite-vec），找到 {len(search_results)} 个结果，去重后 {len(final_results)} 个")
            return final_results
            
        except Exception as e:
            logger.error(f"❌ sqlite-vec搜索失败: {e}，回退到Python计算")
            return self._search_with_python(query_embedding, top_k, filters)

    def _search_with_python(
        self,
        query_embedding: List[float],
        top_k: int,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """使用Python进行向量搜索（回退方案）"""
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
        
        # 检查查询向量维度
        query_dim = len(query_embedding)
        
        # 计算相似度
        results = []
        for embedding_obj, article in embeddings:
            if not embedding_obj.embedding:
                continue
            
            stored_dim = len(embedding_obj.embedding)
            if query_dim != stored_dim:
                # 跳过维度不匹配的向量
                logger.debug(
                    f"⚠️  跳过维度不匹配的文章 {article.id}："
                    f"查询向量维度 {query_dim}，存储向量维度 {stored_dim}"
                )
                continue
            
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
            
            # 处理 topics：确保是列表
            topics = article.topics
            if topics and isinstance(topics, str):
                try:
                    topics = json.loads(topics)
                except (json.JSONDecodeError, TypeError):
                    logger.warning(f"无法解析 topics JSON: {topics}")
                    topics = []
            elif not isinstance(topics, list):
                topics = topics if topics else []
            
            # 处理 tags：确保是列表
            tags = article.tags
            if tags and isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except (json.JSONDecodeError, TypeError):
                    logger.warning(f"无法解析 tags JSON: {tags}")
                    tags = []
            elif not isinstance(tags, list):
                tags = tags if tags else []
            
            search_results.append({
                "id": article.id,
                "title": article.title,
                "title_zh": article.title_zh,
                "url": article.url,
                "summary": article.summary,
                "source": article.source,
                "published_at": article.published_at.isoformat() if article.published_at else None,
                "importance": article.importance,
                "topics": topics,
                "tags": tags,
                "similarity": result["similarity"]
            })
        
        # 去重：按文章ID去重，保留相似度最高的记录
        seen_article_ids = {}
        deduplicated_results = []
        for result in search_results:
            article_id = result["id"]
            if article_id not in seen_article_ids:
                seen_article_ids[article_id] = result
                deduplicated_results.append(result)
            else:
                # 如果已存在，比较相似度，保留更高的
                existing = seen_article_ids[article_id]
                if result["similarity"] > existing["similarity"]:
                    # 替换为相似度更高的记录
                    index = deduplicated_results.index(existing)
                    deduplicated_results[index] = result
                    seen_article_ids[article_id] = result
        
        # 按相似度重新排序（去重后可能顺序改变）
        deduplicated_results.sort(key=lambda x: x["similarity"], reverse=True)
        
        # 限制返回数量
        final_results = deduplicated_results[:top_k]
        
        logger.info(f"✅ 搜索完成（使用Python计算），找到 {len(search_results)} 个结果，去重后 {len(final_results)} 个")
        return final_results

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
            logger.info(f"🔍 开始问答流程: question={question[:100]}, top_k={top_k}")
            
            # 检索相关文章
            try:
                relevant_articles = self.search_articles(question, top_k=top_k)
                logger.info(f"✅ 检索到 {len(relevant_articles)} 篇相关文章")
            except Exception as e:
                logger.error(f"❌ 检索文章失败: {e}", exc_info=True)
                import traceback
                logger.error(f"检索文章完整堆栈:\n{traceback.format_exc()}")
                raise
            
            if not relevant_articles:
                logger.warning("⚠️  没有找到相关文章")
                return {
                    "answer": "抱歉，没有找到相关的文章来回答您的问题。",
                    "sources": [],
                    "articles": []
                }
            
            # 构建上下文
            try:
                context_parts = []
                for i, article_info in enumerate(relevant_articles, 1):
                    try:
                        article_text = f"""
文章 {i}:
标题: {article_info.get('title', 'N/A')}
"""
                        if article_info.get('title_zh'):
                            article_text += f"中文标题: {article_info['title_zh']}\n"
                        if article_info.get('summary'):
                            article_text += f"摘要: {article_info['summary']}\n"
                        if article_info.get('topics'):
                            topics = article_info['topics']
                            if isinstance(topics, list):
                                article_text += f"主题: {', '.join(topics)}\n"
                            else:
                                article_text += f"主题: {topics}\n"
                        article_text += f"来源: {article_info.get('source', 'N/A')}\n"
                        article_text += f"相似度: {article_info.get('similarity', 0):.3f}\n"
                        
                        context_parts.append(article_text)
                    except Exception as e:
                        logger.error(f"❌ 构建文章 {i} 上下文失败: {e}", exc_info=True)
                        logger.error(f"文章信息: {article_info}")
                        continue
                
                context = "\n---\n".join(context_parts)
                logger.info(f"✅ 构建上下文完成，长度: {len(context)} 字符")
            except Exception as e:
                logger.error(f"❌ 构建上下文失败: {e}", exc_info=True)
                import traceback
                logger.error(f"构建上下文完整堆栈:\n{traceback.format_exc()}")
                raise
            
            # 构建提示词
            try:
                prompt = f"""基于以下文章内容，回答用户的问题。请使用中文回答，并引用具体的文章。

相关文章：
{context}

用户问题：{question}

请提供详细、准确的答案，并在回答中引用相关的文章。如果文章中没有足够的信息来回答问题，请说明。"""
                logger.info(f"✅ 提示词构建完成，长度: {len(prompt)} 字符")
            except Exception as e:
                logger.error(f"❌ 构建提示词失败: {e}", exc_info=True)
                raise
            
            # 调用LLM生成答案
            try:
                logger.info(f"🤖 正在调用LLM生成答案...")
                logger.debug(f"使用模型: {self.ai_analyzer.model}")
                logger.debug(f"提示词前100字符: {prompt[:100]}")
                
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
                
                logger.info(f"✅ LLM响应接收成功")
                logger.debug(f"响应对象类型: {type(response)}")
                logger.debug(f"响应choices数量: {len(response.choices) if hasattr(response, 'choices') else 0}")
                
                if not response.choices:
                    raise ValueError("LLM响应中没有choices")
                
                answer = response.choices[0].message.content.strip()
                logger.info(f"✅ 答案生成成功，长度: {len(answer)} 字符")
                
            except Exception as e:
                logger.error(f"❌ 调用LLM失败: {e}", exc_info=True)
                logger.error(f"LLM客户端类型: {type(self.ai_analyzer.client)}")
                logger.error(f"模型名称: {self.ai_analyzer.model}")
                import traceback
                logger.error(f"LLM调用完整堆栈:\n{traceback.format_exc()}")
                raise
            
            # 构建返回结果
            try:
                sources = [article.get("source", "N/A") for article in relevant_articles]
                result = {
                    "answer": answer,
                    "sources": sources,
                    "articles": relevant_articles
                }
                logger.info(f"✅ 问答流程完成: answer长度={len(answer)}, sources数量={len(sources)}, articles数量={len(relevant_articles)}")
                return result
            except Exception as e:
                logger.error(f"❌ 构建返回结果失败: {e}", exc_info=True)
                import traceback
                logger.error(f"构建返回结果完整堆栈:\n{traceback.format_exc()}")
                raise
            
        except Exception as e:
            logger.error(f"❌ 问答失败: {e}", exc_info=True)
            import traceback
            logger.error(f"问答完整堆栈跟踪:\n{traceback.format_exc()}")
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

