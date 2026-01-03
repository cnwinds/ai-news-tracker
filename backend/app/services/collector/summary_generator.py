"""
文章总结生成器
用于生成每日和每周的文章总结
"""
from datetime import datetime, timedelta
from typing import List, Dict, Any
from backend.app.db import DatabaseManager
from backend.app.db.models import Article, DailySummary
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer
import logging

logger = logging.getLogger(__name__)


class SummaryGenerator:
    """文章总结生成器"""

    def __init__(self, ai_analyzer: AIAnalyzer):
        self.ai_analyzer = ai_analyzer

    def generate_daily_summary(self, db: DatabaseManager, date: datetime = None) -> DailySummary:
        """
        生成每日总结

        Args:
            db: 数据库管理器
            date: 总结日期（默认今天），会计算该日期当天的00:00:00至23:59:59

        Returns:
            DailySummary对象
        """
        if date is None:
            date = datetime.now()

        # 计算该天的起始和结束时间
        start_date = date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = date.replace(hour=23, minute=59, second=59, microsecond=999999)

        logger.info(f"📝 生成每日总结: {start_date.strftime('%Y-%m-%d %H:%M:%S')} ~ {end_date.strftime('%Y-%m-%d %H:%M:%S')}")

        # 直接在同一个session中处理所有逻辑
        return self._create_summary(db, start_date, end_date, "daily", date)

    def generate_weekly_summary(self, db: DatabaseManager, date: datetime = None) -> DailySummary:
        """
        生成每周总结

        Args:
            db: 数据库管理器
            date: 总结日期（默认今天），会计算该日期所在ISO周的周一至周日

        Returns:
            DailySummary对象
        """
        if date is None:
            date = datetime.now()

        # 使用ISO周标准计算该周的起始日期（周一）和结束日期（周日）
        # ISO周：周一到周日，每年第一周是包含1月4日的那一周
        # weekday(): Monday=0, Sunday=6
        days_since_monday = date.weekday()
        start_date = date - timedelta(days=days_since_monday)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        end_date = start_date + timedelta(days=6)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        logger.info(f"📝 生成每周总结: {start_date.strftime('%Y-%m-%d')} ~ {end_date.strftime('%Y-%m-%d')}")

        # 使用该周的周日作为summary_date
        summary_date = end_date

        # 直接在同一个session中处理所有逻辑
        return self._create_summary(db, start_date, end_date, "weekly", summary_date)

    def _create_summary(
        self,
        db: DatabaseManager,
        start_date: datetime,
        end_date: datetime,
        summary_type: str,
        date: datetime
    ) -> DailySummary:
        """
        创建总结

        Args:
            db: 数据库管理器
            start_date: 开始时间
            end_date: 结束时间
            summary_type: 总结类型（daily/weekly）
            date: 总结日期

        Returns:
            DailySummary对象
        """
        start_time = datetime.now()

        # 在同一个session中查询文章并提取数据
        with db.get_session() as session:
            # 查询已分析的文章，按重要性和发布时间排序
            articles = session.query(Article).filter(
                Article.is_processed == True,
                Article.published_at >= start_date,
                Article.published_at <= end_date
            ).order_by(
                Article.importance.desc(),
                Article.published_at.desc()
            ).all()

            if not articles:
                logger.warning("⚠️  没有找到符合条件的文章")
                return None

            # 准备文章数据
            articles_data = []
            for article in articles:
                display_title = article.title_zh if article.title_zh else article.title
                articles_data.append({
                    "id": article.id,
                    "title": display_title,
                    "source": article.source,
                    "importance": article.importance,
                    "published_at": article.published_at,
                    "summary": article.summary,
                    "key_points": article.key_points,
                    "topics": article.topics,
                })

        # 统计信息
        high_count = sum(1 for a in articles_data if a.get("importance") == "high")
        medium_count = sum(1 for a in articles_data if a.get("importance") == "medium")

        logger.info(f"  文章总数: {len(articles_data)} (高重要性: {high_count}, 中重要性: {medium_count})")

        # 调用LLM生成总结
        prompt = self._build_summary_prompt(articles_data, summary_type, start_date, end_date)
        summary_content = self.ai_analyzer.client.chat.completions.create(
            model=self.ai_analyzer.model,
            messages=[
                {
                    "role": "system",
                    "content": "你是一个专业的AI领域新闻分析助手，擅长从大量文章中提炼关键信息和趋势。请使用Markdown格式输出所有内容，包括标题、列表、加粗等Markdown语法。"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.3,
            max_tokens=2000
        )
        summary_text = summary_content.choices[0].message.content

        # 提取关键主题
        key_topics = self._extract_topics(articles_data)

        # 推荐重要文章
        recommended_articles = self._select_recommended_articles(articles_data)

        # 计算耗时
        generation_time = (datetime.now() - start_time).total_seconds()

        # 保存到数据库（如果已存在则更新，否则创建）
        with db.get_session() as session:
            # 检查是否已存在相同类型和日期的总结
            # 对于daily类型，比较日期（忽略时间部分）
            # 对于weekly类型，比较summary_date所在的周
            existing_summary = None
            if summary_type == "daily":
                # 每日总结：比较日期（只比较年月日）
                date_only = date.replace(hour=0, minute=0, second=0, microsecond=0)
                existing_summary = session.query(DailySummary).filter(
                    DailySummary.summary_type == summary_type,
                    DailySummary.summary_date >= date_only,
                    DailySummary.summary_date < date_only + timedelta(days=1)
                ).first()
            else:
                # 每周总结：比较summary_date所在的周
                # 计算summary_date所在周的周一和周日
                days_since_monday = date.weekday()
                week_start = date - timedelta(days=days_since_monday)
                week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
                week_end = week_start + timedelta(days=7)
                
                existing_summary = session.query(DailySummary).filter(
                    DailySummary.summary_type == summary_type,
                    DailySummary.summary_date >= week_start,
                    DailySummary.summary_date < week_end
                ).first()
            
            if existing_summary:
                # 更新现有总结
                existing_summary.start_date = start_date
                existing_summary.end_date = end_date
                existing_summary.total_articles = len(articles_data)
                existing_summary.high_importance_count = high_count
                existing_summary.medium_importance_count = medium_count
                existing_summary.summary_content = summary_text
                existing_summary.key_topics = key_topics
                existing_summary.recommended_articles = recommended_articles
                existing_summary.model_used = self.ai_analyzer.model
                existing_summary.generation_time = generation_time
                existing_summary.updated_at = datetime.now()
                session.flush()
                summary_id = existing_summary.id
                logger.info(f"✅ 总结已更新 (ID: {summary_id})")
            else:
                # 创建新总结
                summary = DailySummary(
                    summary_type=summary_type,
                    summary_date=date,
                    start_date=start_date,
                    end_date=end_date,
                    total_articles=len(articles_data),
                    high_importance_count=high_count,
                    medium_importance_count=medium_count,
                    summary_content=summary_text,
                    key_topics=key_topics,
                    recommended_articles=recommended_articles,
                    model_used=self.ai_analyzer.model,
                    generation_time=generation_time
                )
                session.add(summary)
                session.flush()
                summary_id = summary.id
                logger.info(f"✅ 总结已保存 (ID: {summary_id})")
            
        # 在session外创建一个新的对象返回，避免detached instance问题
        return DailySummary(
            id=summary_id,
            summary_type=summary_type,
            summary_date=date,
            start_date=start_date,
            end_date=end_date,
            total_articles=len(articles_data),
            high_importance_count=high_count,
            medium_importance_count=medium_count,
            summary_content=summary_text,
            key_topics=key_topics,
            recommended_articles=recommended_articles,
            model_used=self.ai_analyzer.model,
            generation_time=generation_time
        )

    def _build_summary_prompt(
        self, 
        articles_data: List[Dict[str, Any]], 
        summary_type: str,
        start_date: datetime,
        end_date: datetime
    ) -> str:
        """
        构建总结提示词

        Args:
            articles_data: 文章数据列表
            summary_type: 总结类型（daily/weekly）
            start_date: 开始日期
            end_date: 结束日期

        Returns:
            提示词字符串
        """
        # 根据日期范围生成具体的时间描述
        if summary_type == "daily":
            # 每日总结：显示具体日期
            time_str = start_date.strftime('%Y年%m月%d日')
        else:
            # 每周总结：显示日期范围
            time_str = f"{start_date.strftime('%Y年%m月%d日')} 至 {end_date.strftime('%Y年%m月%d日')}"

        # 选择最重要的文章（最多20篇）
        important_articles = articles_data[:20]

        # 构建文章列表
        articles_str = ""
        for i, article in enumerate(important_articles, 1):
            importance_emoji = "🔴" if article.get("importance") == "high" else "🟡" if article.get("importance") == "medium" else "⚪"
            articles_str += f"""
{i}. {importance_emoji} [{article.get('source', 'Unknown')}] {article.get('title', 'N/A')}
   发布时间: {article.get('published_at', datetime.now()).strftime('%Y-%m-%d %H:%M')}
   摘要: {article.get('summary', '')[:200]}...
"""

        prompt = f"""请基于{time_str}期间采集的以下AI领域文章，生成一份{time_str}的新闻总结。

文章列表：
{articles_str}

请使用Markdown格式输出总结，按以下格式：

# 📊 {time_str}AI新闻总结

## 🔥 重点文章
列出3-5篇最重要的文章，每篇文章格式如下：
- **文章标题（来源）**：直接描述文章的核心内容和重要性，不要使用"核心内容"、"为什么重要"、"文章标题和来源"等任何标签或子标题，直接输出内容即可。例如：
  - **能文能武!智元首个机器人艺人天团亮相湖南卫视跨年演唱会（量子位）**
    智元机器人首次在大型电视节目中亮相，展示了AI机器人在娱乐领域的应用潜力，标志着机器人从工业场景向消费场景的重要突破。

## 📌 重要趋势
从这些文章中总结出2-3个重要趋势或热点话题

## 🎯 推荐阅读
根据文章的关联性和重要性，推荐5-10篇值得深入阅读的文章

**重要提示：请确保输出内容使用标准的Markdown格式，包括标题（#、##）、列表（-、*）、加粗（**文本**）等Markdown语法。请用中文回答，保持专业、简洁的风格。"""

        return prompt

    def _extract_topics(self, articles_data: List[Dict[str, Any]]) -> List[str]:
        """
        从文章中提取关键主题

        Args:
            articles_data: 文章数据列表

        Returns:
            主题列表
        """
        topics_set = set()

        for article in articles_data:
            if article.get("topics"):
                for topic in article.get("topics", []):
                    if topic:
                        topics_set.add(topic)

        return list(topics_set)[:10]  # 最多返回10个主题

    def _select_recommended_articles(self, articles_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        选择推荐文章

        Args:
            articles_data: 文章数据列表

        Returns:
            推荐文章列表
        """
        recommended = []

        # 优先选择高重要性文章
        high_importance = [a for a in articles_data if a.get("importance") == "high"]
        medium_importance = [a for a in articles_data if a.get("importance") == "medium"]

        # 选择最多10篇推荐文章
        selected_articles = (high_importance + medium_importance)[:10]

        for article in selected_articles:
            reason = ""
            if article.get("importance") == "high":
                reason = "高重要性文章，值得重点关注"
            elif article.get("importance") == "medium":
                reason = "中等重要性，建议阅读"
            if article.get("key_points"):
                reason += f"。关键点：{article.get('key_points')[0][:50]}..."

            recommended.append({
                "id": article.get("id"),
                "title": article.get("title"),
                "source": article.get("source"),
                "importance": article.get("importance"),
                "reason": reason
            })

        return recommended
