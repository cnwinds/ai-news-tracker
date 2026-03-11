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
        
        # 标题（最重要，优先索引）
        if article.title:
            parts.append(f"标题: {article.title}")
        
        # 中文标题
        if article.title_zh:
            parts.append(f"中文标题: {article.title_zh}")
        
        # 摘要（优先使用3句话摘要，如果没有则使用精读）
        summary_text = article.summary or article.detailed_summary
        if summary_text:
            parts.append(f"摘要: {summary_text}")
        
        # 内容（增加索引长度以包含更多信息）
        # 使用更长的内容索引，确保能覆盖文章中的关键词
        if article.content:
            # 增加内容索引长度：
            # - 如果有摘要：取前5000字符（之前是2000）
            # - 如果没有摘要：取前8000字符（之前是3000）
            # 这样可以确保文章中的专有名词（如 Nemotron）能被索引到
            max_content_length = 5000 if summary_text else 8000
            content_preview = article.content[:max_content_length]
            parts.append(f"内容: {content_preview}")
        
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
                    # sqlite-vec的vec0表需要JSON数组格式的字符串
                    # 格式: "[0.1, 0.2, 0.3, ...]"
                    vector_str = "[" + ",".join(map(str, embedding)) + "]"
                    
                    # 虚拟表可能不支持 INSERT OR REPLACE，先删除再插入
                    # 先删除旧记录（如果存在）
                    self.db.execute(
                        text("DELETE FROM vec_embeddings WHERE article_id = :article_id"),
                        {"article_id": article.id}
                    )
                    
                    # 插入新记录（使用字符串格式，与初始化代码保持一致）
                    self.db.execute(
                        text("""
                            INSERT INTO vec_embeddings (article_id, embedding)
                            VALUES (:article_id, :embedding)
                        """),
                        {"article_id": article.id, "embedding": vector_str}
                    )
                    self.db.commit()
                except Exception as e:
                    logger.warning(f"⚠️  同步向量到vec0表失败: {e}")
                    # 记录详细错误信息以便调试
                    import traceback
                    logger.debug(f"同步向量详细错误: {traceback.format_exc()}")
            
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
            相似度分数 (0-1)，已归一化
        """
        try:
            v1 = np.array(vec1)
            v2 = np.array(vec2)
            
            dot_product = np.dot(v1, v2)
            norm1 = np.linalg.norm(v1)
            norm2 = np.linalg.norm(v2)
            
            if norm1 == 0 or norm2 == 0:
                return 0.0
            
            # 计算余弦相似度（范围 [-1, 1]）
            cosine_sim = dot_product / (norm1 * norm2)
            
            # 归一化到 [0, 1] 范围：similarity = (cosine_sim + 1) / 2
            # 这样 -1 -> 0, 0 -> 0.5, 1 -> 1.0
            similarity = (cosine_sim + 1.0) / 2.0
            
            # 确保结果在 [0, 1] 范围内（处理浮点误差）
            similarity = max(0.0, min(1.0, similarity))
            
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
            # 注意：k 参数必须大于等于 top_k，我们使用 top_k * 3 以确保有足够的结果用于过滤和去重
            # k 参数必须直接写在 SQL 中，不能作为参数绑定
            k_value = max(top_k * 3, 20)  # 至少返回 20 个结果，确保去重后有足够的结果
            
            # 构建基础查询（包含 is_favorited 字段用于权重计算）
            # 注意：sqlite-vec 的 MATCH 操作符返回的距离是余弦距离（如果使用 DISTANCE_METRIC=cosine）
            sql = f"""
                SELECT 
                    v.article_id,
                    distance,
                    a.id, a.title, a.title_zh, a.url, a.summary, a.source,
                    a.published_at, a.importance, a.tags, a.is_favorited
                FROM vec_embeddings v
                JOIN articles a ON v.article_id = a.id
                WHERE v.embedding MATCH :query_vector AND k = {k_value}
            """
            
            logger.debug(f"执行向量搜索: k={k_value}, query_vector长度={len(query_embedding)}")
            
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
            
            # 按距离排序（距离越小越相似），不在这里限制数量，让去重后再限制
            # 这样可以确保去重后有足够的结果
            sql += " ORDER BY distance"
            
            # 执行查询
            result = self.db.execute(text(sql), params)
            rows = result.fetchall()
            
            logger.info(f"查询返回 {len(rows)} 条结果")
            
            # 转换为字典格式
            search_results = []
            for idx, row in enumerate(rows):
                distance = float(row[1]) if row[1] is not None else float('inf')
                article_id = row[0]
                
                if distance < float('inf'):
                    # 使用余弦距离（因为表已配置 DISTANCE_METRIC=cosine）
                    # 余弦距离范围是 [0, 2]：
                    # - 0 表示完全相同（余弦相似度 = 1.0）
                    # - 1 表示正交（余弦相似度 = 0.0）
                    # - 2 表示完全相反（余弦相似度 = -1.0）
                    # 余弦距离 = 1 - 余弦相似度
                    # 所以：余弦相似度 = 1 - 余弦距离
                    # 但余弦相似度范围是 [-1, 1]，需要归一化到 [0, 1]
                    # 归一化公式：normalized_similarity = (cosine_similarity + 1) / 2
                    # 合并：normalized_similarity = (1 - distance + 1) / 2 = (2 - distance) / 2 = 1 - distance/2
                    
                    if distance <= 2.0:
                        # 方法1：直接归一化
                        # normalized_similarity = 1 - distance/2
                        # 这样：distance=0 -> similarity=1.0, distance=1 -> similarity=0.5, distance=2 -> similarity=0.0
                        similarity = 1.0 - (distance / 2.0)
                        similarity = max(0.0, min(1.0, similarity))  # 确保在 [0, 1] 范围内
                        
                        # 调试日志（前5个结果）
                        if idx < 5:
                            logger.info(f"文章 {article_id}: distance={distance:.4f}, similarity={similarity:.4f} ({similarity*100:.1f}%)")
                    else:
                        # 如果距离 > 2.0，可能是异常值，使用 L2 转换公式
                        logger.warning(f"文章 {article_id}: 检测到异常距离值 {distance}，使用 L2 转换公式")
                        similarity = 1.0 / (1.0 + distance)
                else:
                    similarity = 0.0
                    logger.warning(f"文章 {article_id}: 距离值为无穷大，设置相似度为 0.0")
                
                # 如果文章被收藏，增加权重（提升相似度分数）
                is_favorited = row[12] if len(row) > 12 else False
                if is_favorited:
                    # 增加 0.2 的相似度权重，确保收藏文章排在前面
                    similarity = min(1.0, similarity + 0.2)
                
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
                
                # 处理 tags：可能是列表或 JSON 字符串
                tags = row[10]
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
                    "tags": tags,
                    "similarity": similarity,
                    "is_favorited": is_favorited
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
            
            # 如果文章被收藏，增加权重（提升相似度分数）
            if article.is_favorited:
                # 增加 0.2 的相似度权重，确保收藏文章排在前面
                similarity = min(1.0, similarity + 0.2)
            
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
                "tags": tags,
                "similarity": result["similarity"],
                "is_favorited": article.is_favorited
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

    def query_articles(
        self, 
        question: str, 
        top_k: int = 5,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> Dict[str, Any]:
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
            
            # 构建增强的查询：如果有对话历史，将历史上下文也考虑进去
            enhanced_query = question
            if conversation_history and len(conversation_history) > 0:
                # 提取最近几轮对话的关键信息，增强查询
                # 只取最近的 2-3 轮对话，避免查询过长
                recent_history = conversation_history[-4:] if len(conversation_history) > 4 else conversation_history
                history_context = " ".join([
                    msg.get("content", "")[:200]  # 限制每条消息长度
                    for msg in recent_history
                    if msg.get("role") == "user" or msg.get("role") == "assistant"
                ])
                if history_context:
                    # 将历史上下文和当前问题结合，提高检索准确性
                    enhanced_query = f"{history_context} {question}"
                    logger.debug(f"使用增强查询（包含对话历史）: {enhanced_query[:200]}...")
            
            # 检索相关文章
            try:
                relevant_articles = self.search_articles(enhanced_query, top_k=top_k)
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

请提供详细、准确的答案，并在回答中引用相关的文章。引用格式要求：
1. 使用 [文章编号] 的格式引用，例如：[1] 提到："..." 或 [2] 指出：...
2. 不要在引用中包含文章标题和来源名称，只使用编号引用
3. 如果文章中没有足够的信息来回答问题，请说明。"""
                logger.info(f"✅ 提示词构建完成，长度: {len(prompt)} 字符")
            except Exception as e:
                logger.error(f"❌ 构建提示词失败: {e}", exc_info=True)
                raise
            
            # 调用LLM生成答案
            try:
                logger.info(f"🤖 正在调用LLM生成答案...")
                logger.debug(f"使用模型: {self.ai_analyzer.model}")
                logger.debug(f"提示词前100字符: {prompt[:100]}")
                
                # 构建消息列表，包含对话历史
                messages = [
                    {
                        "role": "system",
                        "content": "你是一个专业的AI新闻助手，擅长基于提供的文章内容回答问题。请使用中文回答，并准确引用文章来源。如果用户的问题是基于之前对话的追问，请结合对话历史来理解问题的上下文。"
                    }
                ]
                
                # 如果有对话历史，添加到消息列表中
                if conversation_history and len(conversation_history) > 0:
                    # 只取最近的对话历史（避免token过多）
                    recent_history = conversation_history[-8:] if len(conversation_history) > 8 else conversation_history
                    for msg in recent_history:
                        role = msg.get("role", "")
                        content = msg.get("content", "")
                        if role in ["user", "assistant"]:
                            messages.append({
                                "role": role,
                                "content": content[:1000]  # 限制每条消息长度
                            })
                
                # 添加当前问题的提示词
                messages.append({
                    "role": "user",
                    "content": prompt
                })
                
                response = self.ai_analyzer.client.chat.completions.create(
                    model=self.ai_analyzer.model,
                    messages=messages,
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

    def query_articles_stream(
        self, 
        question: str, 
        top_k: int = 5,
        conversation_history: Optional[List[Dict[str, str]]] = None
    ):
        """
        RAG问答（流式）：基于检索到的文章回答问题，支持流式输出

        Args:
            question: 问题文本
            top_k: 检索的文章数量
            conversation_history: 对话历史，用于保持上下文连续性

        Yields:
            流式数据块，包含类型和内容
        """
        try:
            logger.info(f"🔍 开始流式问答流程: question={question[:100]}, top_k={top_k}")
            
            # 构建增强的查询：如果有对话历史，将历史上下文也考虑进去
            enhanced_query = question
            if conversation_history and len(conversation_history) > 0:
                # 提取最近几轮对话的关键信息，增强查询
                recent_history = conversation_history[-4:] if len(conversation_history) > 4 else conversation_history
                history_context = " ".join([
                    msg.get("content", "")[:200]
                    for msg in recent_history
                    if msg.get("role") == "user" or msg.get("role") == "assistant"
                ])
                if history_context:
                    enhanced_query = f"{history_context} {question}"
                    logger.debug(f"使用增强查询（包含对话历史）: {enhanced_query[:200]}...")
            
            # 检索相关文章
            try:
                relevant_articles = self.search_articles(enhanced_query, top_k=top_k)
                logger.info(f"✅ 检索到 {len(relevant_articles)} 篇相关文章")
                
                # 先发送文章信息
                yield {
                    "type": "articles",
                    "data": {
                        "articles": relevant_articles,
                        "sources": [article.get("source", "N/A") for article in relevant_articles]
                    }
                }
            except Exception as e:
                logger.error(f"❌ 检索文章失败: {e}", exc_info=True)
                yield {
                    "type": "error",
                    "data": {"message": f"检索文章失败: {str(e)}"}
                }
                return
            
            if not relevant_articles:
                logger.warning("⚠️  没有找到相关文章")
                yield {
                    "type": "error",
                    "data": {"message": "抱歉，没有找到相关的文章来回答您的问题。"}
                }
                return
            
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
                yield {
                    "type": "error",
                    "data": {"message": f"构建上下文失败: {str(e)}"}
                }
                return
            
            # 构建提示词
            try:
                # 如果有对话历史，在提示词中包含历史上下文
                history_context_str = ""
                if conversation_history and len(conversation_history) > 0:
                    recent_history = conversation_history[-6:] if len(conversation_history) > 6 else conversation_history
                    history_parts = []
                    for msg in recent_history:
                        role = msg.get("role", "")
                        content = msg.get("content", "")
                        if role == "user":
                            history_parts.append(f"用户: {content}")
                        elif role == "assistant":
                            history_parts.append(f"助手: {content}")
                    
                    if history_parts:
                        history_context_str = f"\n\n对话历史：\n" + "\n".join(history_parts) + "\n"
                        logger.debug(f"包含对话历史: {len(history_parts)} 条消息")
                
                prompt = f"""基于以下文章内容，回答用户的问题。请使用中文回答，并引用具体的文章。{history_context_str}

相关文章：
{context}

用户问题：{question}

请提供详细、准确的答案，并在回答中引用相关的文章。引用格式要求：
1. 使用 [文章编号] 的格式引用，例如：[1] 提到："..." 或 [2] 指出：...
2. 不要在引用中包含文章标题和来源名称，只使用编号引用
3. 如果文章中没有足够的信息来回答问题，请说明。
4. 如果用户的问题是基于之前对话的追问，请结合对话历史来理解问题的上下文。"""
                logger.info(f"✅ 提示词构建完成，长度: {len(prompt)} 字符")
            except Exception as e:
                logger.error(f"❌ 构建提示词失败: {e}", exc_info=True)
                yield {
                    "type": "error",
                    "data": {"message": f"构建提示词失败: {str(e)}"}
                }
                return
            
            # 调用LLM生成答案（流式）
            try:
                logger.info(f"🤖 正在调用LLM生成答案（流式）...")
                logger.debug(f"使用模型: {self.ai_analyzer.model}")
                
                # 构建消息列表，包含对话历史
                messages = [
                    {
                        "role": "system",
                        "content": "你是一个专业的AI新闻助手，擅长基于提供的文章内容回答问题。请使用中文回答，并准确引用文章来源。如果用户的问题是基于之前对话的追问，请结合对话历史来理解问题的上下文。"
                    }
                ]
                
                # 如果有对话历史，添加到消息列表中
                if conversation_history and len(conversation_history) > 0:
                    # 只取最近的对话历史（避免token过多）
                    recent_history = conversation_history[-8:] if len(conversation_history) > 8 else conversation_history
                    for msg in recent_history:
                        role = msg.get("role", "")
                        content = msg.get("content", "")
                        if role in ["user", "assistant"]:
                            messages.append({
                                "role": role,
                                "content": content[:1000]  # 限制每条消息长度
                            })
                
                # 添加当前问题的提示词
                messages.append({
                    "role": "user",
                    "content": prompt
                })
                
                stream = self.ai_analyzer.client.chat.completions.create(
                    model=self.ai_analyzer.model,
                    messages=messages,
                    temperature=0.3,
                    max_tokens=2000,
                    stream=True,  # 启用流式输出
                )
                
                # 流式返回内容
                for chunk in stream:
                    if chunk.choices and len(chunk.choices) > 0:
                        delta = chunk.choices[0].delta
                        if delta.content:
                            yield {
                                "type": "content",
                                "data": {"content": delta.content}
                            }
                
                # 发送完成信号
                yield {
                    "type": "done",
                    "data": {}
                }
                logger.info(f"✅ 流式答案生成完成")
                
            except Exception as e:
                logger.error(f"❌ 调用LLM失败: {e}", exc_info=True)
                yield {
                    "type": "error",
                    "data": {"message": f"生成答案时出现错误: {str(e)}"}
                }
                return
            
        except Exception as e:
            logger.error(f"❌ 流式问答失败: {e}", exc_info=True)
            import traceback
            logger.error(f"流式问答完整堆栈跟踪:\n{traceback.format_exc()}")
            yield {
                "type": "error",
                "data": {"message": f"抱歉，生成答案时出现错误: {str(e)}"}
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

