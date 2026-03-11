"""
文章总结生成器
用于生成每日和每周的文章总结
"""
from datetime import datetime, timedelta
from typing import List, Dict, Any
from backend.app.db import DatabaseManager
from backend.app.db.models import Article, DailySummary
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer
from backend.app.core.settings import settings
from backend.app.services.collector.summary_prompts import (
    DEFAULT_DAILY_SUMMARY_PROMPT_TEMPLATE,
    DEFAULT_WEEKLY_SUMMARY_PROMPT_TEMPLATE,
)
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
            date: 总结日期（默认今天），会计算该日期所在自定义周的周六至周五
            自定义周规则：周六、周日、周一到周五，为一个总结周

        Returns:
            DailySummary对象
        """
        if date is None:
            date = datetime.now()

        # 使用自定义周标准计算该周的起始日期（周六）和结束日期（周五）
        # 自定义周：周六到周五，weekday(): Monday=0, Sunday=6
        # 需要找到该日期所在周的周六（起始）和周五（结束）
        weekday = date.weekday()  # Monday=0, Tuesday=1, ..., Sunday=6
        
        # 计算距离上周六的天数
        # 如果今天是周六(5)，则距离上周六是0天
        # 如果今天是周日(6)，则距离上周六是1天
        # 如果今天是周一(0)，则距离上周六是2天
        # 如果今天是周五(4)，则距离上周六是6天
        if weekday == 5:  # 周六
            days_since_saturday = 0
        elif weekday == 6:  # 周日
            days_since_saturday = 1
        else:  # 周一到周五
            days_since_saturday = weekday + 2
        
        start_date = date - timedelta(days=days_since_saturday)
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # 结束日期是周五（起始日期+6天）
        end_date = start_date + timedelta(days=6)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        logger.info(f"📝 生成每周总结: {start_date.strftime('%Y-%m-%d')} ~ {end_date.strftime('%Y-%m-%d')}")

        # 使用该周的周五作为summary_date
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
                    "url": article.url,
                })

        # 统计信息
        high_count = sum(1 for a in articles_data if a.get("importance") == "high")
        medium_count = sum(1 for a in articles_data if a.get("importance") == "medium")

        logger.info(f"  文章总数: {len(articles_data)} (高重要性: {high_count}, 中重要性: {medium_count})")

        # 调用LLM生成总结
        prompt = self._build_summary_prompt(articles_data, summary_type, start_date, end_date)
        
        # 根据总结类型设置不同的系统提示词和参数
        if summary_type == "weekly":
            # 周报使用专业的行业分析师角色和更高的参数
            system_prompt = """你是一名资深的行业分析师和风向洞察者，拥有超过15年的从业经验。你不仅关注新闻事件的表面，更擅长从纷繁复杂的信息中，穿透表象，识别出那些真正能够影响行业格局的潜在变化、新兴趋势和关键信号。你的分析以深刻、前瞻和高度概括性著称，旨在为决策者提供高价值的参考。

请使用Markdown格式输出所有内容，包括标题、列表、加粗等Markdown语法。"""
            temperature = 0.5  # 周报需要更多创造性分析
            max_tokens = 4000  # 周报需要更详细的分析
        else:
            # 日报使用原有的系统提示词
            system_prompt = "你是一个专业的AI领域新闻分析助手，擅长从大量文章中提炼关键信息和趋势。请使用Markdown格式输出所有内容，包括标题、列表、加粗等Markdown语法。"
            temperature = 0.3
            max_tokens = 2000
        
        try:
            logger.info(f"🤖 调用LLM生成{summary_type}总结，模型: {self.ai_analyzer.model}, 文章数: {len(articles_data)}")
            logger.debug(f"   提示词长度: {len(prompt)} 字符")
            logger.debug(f"   系统提示词长度: {len(system_prompt)} 字符")
            
            summary_content = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=temperature,
                max_tokens=max_tokens
            )
            summary_text = summary_content.choices[0].message.content
            logger.info(f"✅ LLM生成成功，响应长度: {len(summary_text)} 字符")
        except Exception as e:
            # 记录错误信息（包含必要参数）
            error_type = type(e).__name__
            logger.error(
                f"LLM调用失败 [{summary_type}] | 模型: {self.ai_analyzer.model} | "
                f"文章数: {len(articles_data)} | 提示词: {len(prompt)}/{len(system_prompt)}字符 | "
                f"temperature={temperature}, max_tokens={max_tokens} | {error_type}: {str(e)}"
            )
            raise

        # 提取关键主题
        key_topics = self._extract_topics(articles_data)

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
                # 每周总结：比较summary_date所在的自定义周（周六到周五）
                # 计算summary_date所在周的周六和周五
                weekday = date.weekday()
                if weekday == 5:  # 周六
                    days_since_saturday = 0
                elif weekday == 6:  # 周日
                    days_since_saturday = 1
                else:  # 周一到周五
                    days_since_saturday = weekday + 2
                
                week_start = date - timedelta(days=days_since_saturday)
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
            date_range = time_str
        else:
            # 每周总结：显示日期范围
            date_range = f"{start_date.strftime('%Y年%m月%d日')} 至 {end_date.strftime('%Y年%m月%d日')}"
            time_str = date_range

        # 选择最重要的文章（周报使用更多文章，日报保持原样）
        if summary_type == "weekly":
            important_articles = articles_data[:300]  # 周报使用更多文章进行分析
        else:
            important_articles = articles_data[:100]

        # 构建文章列表
        articles_str = ""
        for i, article in enumerate(important_articles, 1):
            importance_emoji = "🔴" if article.get("importance") == "high" else "🟡" if article.get("importance") == "medium" else "⚪"
            article_id = article.get('id', 'N/A')
            # 周报需要更详细的信息
            if summary_type == "weekly":
                articles_str += f"""
{i}. {importance_emoji} [ID: {article_id}] [{article.get('source', 'Unknown')}] {article.get('title', 'N/A')}
   发布时间: {article.get('published_at', datetime.now()).strftime('%Y-%m-%d %H:%M')}
   链接: {article.get('url', 'N/A')}
   摘要: {article.get('summary', '')[:1000]}
"""
            else:
                articles_str += f"""
{i}. {importance_emoji} [ID: {article_id}] [{article.get('source', 'Unknown')}] {article.get('title', 'N/A')}
   发布时间: {article.get('published_at', datetime.now()).strftime('%Y-%m-%d %H:%M')}
   链接: {article.get('url', 'N/A')}
   摘要: {article.get('summary', '')[:1000]}...
"""

        settings.load_settings_from_db()
        if summary_type == "weekly":
            prompt_template = settings.WEEKLY_SUMMARY_PROMPT_TEMPLATE or DEFAULT_WEEKLY_SUMMARY_PROMPT_TEMPLATE
        else:
            prompt_template = settings.DAILY_SUMMARY_PROMPT_TEMPLATE or DEFAULT_DAILY_SUMMARY_PROMPT_TEMPLATE

        return self._render_prompt_template(
            prompt_template=prompt_template,
            time_str=time_str,
            date_range=date_range,
            articles_str=articles_str,
        )

    def _render_prompt_template(
        self,
        prompt_template: str,
        time_str: str,
        date_range: str,
        articles_str: str,
    ) -> str:
        """
        渲染提示词模板

        Args:
            prompt_template: 提示词模板内容
            time_str: 时间字符串
            date_range: 日期范围字符串
            articles_str: 文章列表字符串

        Returns:
            渲染后的提示词字符串
        """
        template_has_articles = "{{articles}}" in prompt_template
        rendered = prompt_template
        rendered = rendered.replace("{{time_str}}", time_str or "")
        rendered = rendered.replace("{{date_range}}", date_range or "")
        rendered = rendered.replace("{{articles}}", articles_str or "")

        if not template_has_articles:
            rendered = f"{rendered}\n\n文章列表：\n{articles_str}"

        return rendered

    def _extract_topics(self, articles_data: List[Dict[str, Any]]) -> List[str]:
        """
        从文章中提取关键主题（从摘要中提取）

        Args:
            articles_data: 文章数据列表

        Returns:
            主题列表（空列表，因为不再从topics字段提取）
        """
        # 不再从topics字段提取，返回空列表
        return []
