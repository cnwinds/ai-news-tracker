"""
社交平台热帖报告生成器
根据n8n工作流逻辑实现热点小报生成
"""
import logging
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from sqlalchemy.orm import Session

from backend.app.db.models import SocialMediaPost, SocialMediaReport

logger = logging.getLogger(__name__)


class SocialMediaReportGenerator:
    """社交平台热帖报告生成器"""

    def __init__(self, ai_analyzer=None):
        """
        初始化报告生成器

        Args:
            ai_analyzer: AI分析器实例(可选)
        """
        self.ai_analyzer = ai_analyzer

    def generate_daily_report(
        self,
        db: Session,
        posts: List[SocialMediaPost],
        report_date: Optional[datetime] = None,
        youtube_enabled: bool = True,
        tiktok_enabled: bool = True,
        twitter_enabled: bool = True,
        reddit_enabled: bool = True
    ) -> Optional[SocialMediaReport]:
        """
        生成AI热点小报（基于传入的采集数据）

        Args:
            db: 数据库会话
            posts: 采集到的帖子列表（本次采集的实时数据）
            report_date: 报告日期(默认今天)
            youtube_enabled: 是否启用YouTube
            tiktok_enabled: 是否启用TikTok
            twitter_enabled: 是否启用Twitter
            reddit_enabled: 是否启用Reddit

        Returns:
            生成的报告对象
        """
        try:
            if not report_date:
                report_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

            if not posts:
                logger.warning(f"没有传入采集数据，无法生成报告")
                return None

            # 按平台分组并去重(使用post_id去重,保留第一个)
            youtube_posts_map = {}
            tiktok_posts_map = {}
            twitter_posts_map = {}
            reddit_posts_map = {}

            for post in posts:
                if post.platform == "youtube" and youtube_enabled:
                    if post.post_id not in youtube_posts_map:
                        youtube_posts_map[post.post_id] = post
                elif post.platform == "tiktok" and tiktok_enabled:
                    if post.post_id not in tiktok_posts_map:
                        tiktok_posts_map[post.post_id] = post
                elif post.platform == "twitter" and twitter_enabled:
                    if post.post_id not in twitter_posts_map:
                        twitter_posts_map[post.post_id] = post
                elif post.platform == "reddit" and reddit_enabled:
                    if post.post_id not in reddit_posts_map:
                        reddit_posts_map[post.post_id] = post

            youtube_posts = list(youtube_posts_map.values())
            tiktok_posts = list(tiktok_posts_map.values())
            twitter_posts = list(twitter_posts_map.values())
            reddit_posts = list(reddit_posts_map.values())

            # 按爆款分数排序
            youtube_posts.sort(key=lambda x: x.viral_score or 0, reverse=True)
            tiktok_posts.sort(key=lambda x: x.viral_score or 0, reverse=True)
            twitter_posts.sort(key=lambda x: x.viral_score or 0, reverse=True)
            reddit_posts.sort(key=lambda x: x.viral_score or 0, reverse=True)

            # 使用LLM翻译标题和判断价值（异步处理，不阻塞）
            if self.ai_analyzer:
                youtube_posts = self._translate_posts(db, youtube_posts)
                tiktok_posts = self._translate_posts(db, tiktok_posts)
                reddit_posts = self._translate_posts(db, reddit_posts)
                # Twitter: 先翻译,再过滤价值
                twitter_posts = self._translate_posts(db, twitter_posts)
                twitter_posts = self._filter_valuable_tweets(db, twitter_posts)

                # 保存翻译结果到数据库（批量更新对应的数据库记录）
                try:
                    self._save_translation_to_db(db, youtube_posts + tiktok_posts + reddit_posts + twitter_posts)
                    db.commit()
                    logger.debug("保存翻译和价值判断结果到数据库成功")
                except Exception as e:
                    logger.warning(f"保存翻译结果失败: {e}")
                    db.rollback()

            # 生成报告内容（按照n8n工作流的"热点小报"格式）
            report_content = self._generate_hotspot_report(
                youtube_posts=youtube_posts[:20],  # 每个平台最多20条
                tiktok_posts=tiktok_posts[:20],
                twitter_posts=twitter_posts[:20],
                reddit_posts=reddit_posts[:20],
                report_date=report_date
            )

            # 创建AI热点小报记录
            # total_count应该是各平台过滤后数量的总和，而不是原始posts的长度
            total_count = len(youtube_posts) + len(tiktok_posts) + len(twitter_posts) + len(reddit_posts)
            report = SocialMediaReport(
                report_date=report_date,
                youtube_count=len(youtube_posts),
                tiktok_count=len(tiktok_posts),
                twitter_count=len(twitter_posts),
                reddit_count=len(reddit_posts),
                total_count=total_count,
                report_content=report_content,
                youtube_enabled=youtube_enabled,
                tiktok_enabled=tiktok_enabled,
                twitter_enabled=twitter_enabled,
                reddit_enabled=reddit_enabled
            )

            db.add(report)
            db.commit()
            db.refresh(report)

            return report

        except Exception as e:
            logger.error(f"生成AI热点小报失败: {e}")
            db.rollback()
            return None

    def _translate_posts(self, db: Session, posts: List[SocialMediaPost]) -> List[SocialMediaPost]:
        """
        翻译帖子标题为中文（使用缓存优化）

        Args:
            db: 数据库会话
            posts: 帖子列表

        Returns:
            翻译后的帖子列表
        """
        if not self.ai_analyzer:
            return posts

        translated_posts = []
        cache_hits = 0
        llm_calls = 0

        for post in posts:
            try:
                # 如果内存中已经有中文标题（来自API端点预填充），跳过
                if post.title_zh:
                    cache_hits += 1
                    translated_posts.append(post)
                    continue

                # 从数据库查询翻译缓存
                cached_title = None
                if post.post_id:
                    cached_post = db.query(SocialMediaPost).filter(
                        SocialMediaPost.post_id == post.post_id,
                        SocialMediaPost.title_zh.isnot(None),
                        SocialMediaPost.title_zh != ''
                    ).first()
                    if cached_post:
                        cached_title = cached_post.title_zh

                if cached_title:
                    cache_hits += 1
                    post.title_zh = cached_title
                    translated_posts.append(post)
                    continue

                # 翻译标题
                llm_calls += 1
                title_zh = self._translate_title(post.title or post.content[:200] or "")
                if title_zh:
                    post.title_zh = title_zh
                translated_posts.append(post)
            except Exception as e:
                logger.warning(f"翻译标题失败: {e}")
                translated_posts.append(post)

        if len(posts) > 0:
            logger.info(f"翻译完成: 总数={len(posts)}, 缓存命中={cache_hits}, LLM调用={llm_calls}")

        return translated_posts

    def _save_translation_to_db(self, db: Session, posts: List[SocialMediaPost]):
        """
        将临时对象中的翻译和价值判断结果保存到数据库

        Args:
            db: 数据库会话
            posts: 帖子列表（可能是临时对象）
        """
        # 按 post_id 分组，批量查询对应的数据库记录
        post_ids = [p.post_id for p in posts if p.post_id]
        if not post_ids:
            return

        # 批量查询数据库中的记录
        db_posts = db.query(SocialMediaPost).filter(
            SocialMediaPost.post_id.in_(post_ids)
        ).all()

        # 创建 post_id -> db_post 的映射
        db_posts_map = {p.post_id: p for p in db_posts}

        updated_count = 0
        for temp_post in posts:
            if not temp_post.post_id or temp_post.post_id not in db_posts_map:
                continue

            db_post = db_posts_map[temp_post.post_id]

            # 更新翻译结果
            if temp_post.title_zh and not db_post.title_zh:
                db_post.title_zh = temp_post.title_zh
                updated_count += 1

            # 更新价值判断结果
            if hasattr(temp_post, 'has_value') and temp_post.has_value is not None and db_post.has_value is None:
                db_post.has_value = temp_post.has_value
                updated_count += 1

        if updated_count > 0:
            logger.debug(f"保存翻译和价值判断结果: 更新{updated_count}条记录")

    def _translate_title(self, title: str) -> Optional[str]:
        """
        使用LLM翻译标题为中文

        Args:
            title: 原标题

        Returns:
            中文标题
        """
        if not self.ai_analyzer or not title:
            return None

        try:
            prompt = f"""你是一名新闻编辑，任务是将不同来源的标题翻译成中文，要求简洁、准确、有逻辑。请确保输出全是中文。

标题：{title}

若标题内容大于三句话，则根据标题里所有的信息生成一段60–80字的中文摘要，遵循以下步骤和格式：

#步骤
1. 提取主语和核心动作，格式为"谁做了什么"
2. 概括主要功能或用途，格式为"实现什么功能，达到什么效果"
3. 如有亮点或创新点，请加以总结
4. 强调主观意义或影响，格式为"对什么有重要意义"

#输出要求
- 只返回翻译后的中文标题或摘要，不要添加任何说明
- 如果标题较短，直接翻译；如果较长，生成60-80字摘要

中文标题："""

            response = self.ai_analyzer.create_completion(
                [
                    {"role": "system", "content": "你是一名专业的新闻编辑，擅长将英文标题翻译成准确、简洁的中文标题。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=200,
            )
            translated = response.choices[0].message.content.strip()
            # 去除可能的引号
            translated = translated.strip('"').strip("'").strip()
            return translated

        except Exception as e:
            logger.warning(f"翻译标题失败: {e}")
            return None

    def _filter_valuable_tweets(self, db: Session, posts: List[SocialMediaPost]) -> List[SocialMediaPost]:
        """
        过滤有价值的Twitter推文（根据n8n工作流逻辑，使用缓存优化）

        Args:
            db: 数据库会话
            posts: 推文列表

        Returns:
            有价值的推文列表
        """
        if not self.ai_analyzer:
            return posts

        valuable_posts = []
        cache_hits = 0
        llm_calls = 0
        error_count = 0

        for post in posts:
            try:
                # 如果内存中已经判断过价值（来自API端点预填充），使用已有结果
                if hasattr(post, 'has_value') and post.has_value is not None:
                    cache_hits += 1
                    if post.has_value:
                        valuable_posts.append(post)
                    continue

                # 从数据库查询价值判断缓存
                cached_value = None
                if post.post_id:
                    cached_post = db.query(SocialMediaPost).filter(
                        SocialMediaPost.post_id == post.post_id,
                        SocialMediaPost.has_value.isnot(None)
                    ).first()
                    if cached_post:
                        cached_value = cached_post.has_value

                if cached_value is not None:
                    cache_hits += 1
                    post.has_value = cached_value
                    if post.has_value:
                        valuable_posts.append(post)
                    continue

                # 使用LLM判断信息价值
                llm_calls += 1
                has_value = self._judge_tweet_value(post)
                post.has_value = has_value
                logger.debug(f"Twitter推文价值判断: post_id={post.post_id}, has_value={has_value}, title={post.title[:50] if post.title else ''}")
                if has_value:
                    valuable_posts.append(post)
            except Exception as e:
                error_count += 1
                logger.warning(f"判断推文价值失败: post_id={post.post_id if post.post_id else 'unknown'}, error={e}")
                # 出错时默认保留
                valuable_posts.append(post)

        if len(posts) > 0:
            logger.info(f"Twitter价值判断完成: 总数={len(posts)}, 缓存命中={cache_hits}, LLM调用={llm_calls}, 错误={error_count}")

        return valuable_posts

    def _judge_tweet_value(self, post: SocialMediaPost) -> bool:
        """
        判断推文是否有信息价值

        Args:
            post: 推文对象

        Returns:
            是否有价值
        """
        if not self.ai_analyzer:
            return True

        try:
            prompt = f"""你是一名AI科技新闻编辑，任务是判断推文是否具有AI相关的信息价值。

输入信息：
标题：{post.title or post.content[:200] or ''}
来源：{post.author_name or ''}
日期：{post.published_at.strftime('%Y-%m-%d') if post.published_at else ''}
链接：{post.post_url or ''}
板块：Twitter热点

判断标准：
- 若内容包含AI产品、模型、研究、趋势、观点、政策、社会影响等信息 → 有信息价值。
- 若仅为图片、情绪表达、无关娱乐、擦边、闲聊或与AI无关 → 无信息价值。

请只返回JSON格式：
{{
  "有信息价值": true/false,
  "理由": "判断理由"
}}

只返回JSON，不要其他内容。"""

            messages = [
                {"role": "system", "content": "你是一名AI科技新闻编辑，擅长判断内容的信息价值。只返回JSON格式。"},
                {"role": "user", "content": prompt}
            ]
            kwargs = {"temperature": 0.3, "max_tokens": 200}
            try:
                if "gpt-4" in self.ai_analyzer.model.lower() or "o1" in self.ai_analyzer.model.lower():
                    kwargs["response_format"] = {"type": "json_object"}
            except Exception:
                pass
            response = self.ai_analyzer.create_completion(messages, **kwargs)
            result_text = response.choices[0].message.content.strip()
            # 尝试解析JSON
            try:
                result = json.loads(result_text)
                has_value = result.get("有信息价值", result.get("has_value", True))
                logger.debug(f"AI判断结果: {result_text[:200]}, has_value={has_value}")
                return bool(has_value)
            except json.JSONDecodeError:
                # 如果JSON解析失败，尝试从文本中提取
                logger.warning(f"JSON解析失败，尝试文本提取: {result_text[:200]}")
                if "true" in result_text.lower() or "有信息价值" in result_text or "true" in result_text:
                    return True
                # 如果明确说false，才返回False，否则默认保留
                if "false" in result_text.lower() and "无信息价值" in result_text:
                    return False
                # 默认保留，避免误过滤
                logger.warning(f"无法确定价值，默认保留推文")
                return True

        except Exception as e:
            logger.warning(f"判断推文价值失败: {e}, 默认保留")
            # 出错时默认保留
            return True

    def _generate_hotspot_report(
        self,
        youtube_posts: List[SocialMediaPost],
        tiktok_posts: List[SocialMediaPost],
        twitter_posts: List[SocialMediaPost],
        reddit_posts: List[SocialMediaPost],
        report_date: datetime
    ) -> str:
        """
        生成热点小报（按照n8n工作流格式）

        Args:
            youtube_posts: YouTube热帖列表
            tiktok_posts: TikTok热帖列表
            twitter_posts: Twitter热帖列表
            reddit_posts: Reddit热帖列表
            report_date: 报告日期

        Returns:
            Markdown格式的报告内容
        """
        date_str = report_date.strftime("%Y-%m-%d")
        md_lines = [f"# {date_str} AI热点小报\n"]

        # YouTube热点
        if youtube_posts:
            md_lines.append("\n🔥 **YouTube热点**\n")

            # 按来源分组（类似n8n工作流中的"短视频"等分类）
            by_source = {}
            for post in youtube_posts:
                # 根据n8n工作流，来源可能是"短视频"或其他分类
                source = post.author_name or "短视频"
                if source not in by_source:
                    by_source[source] = []
                by_source[source].append(post)

            # 遍历每个来源
            for source, posts in by_source.items():
                md_lines.append(f"\n**{source}**\n")
                for post in posts:
                    title = post.title_zh or post.title or post.content[:100] or "无标题"
                    md_lines.append(f"- {title}\n{post.post_url or ''}\n")

            md_lines.append("\n---\n\n")

        # Twitter热点
        if twitter_posts:
            md_lines.append("\n🔥 **Twitter热点**\n")
            for post in twitter_posts:
                title = post.title_zh or post.title or post.content[:200] or "无标题"
                md_lines.append(f"- {title}\n{post.post_url or ''}\n")
            md_lines.append("\n---\n\n")

        # Reddit热点
        if reddit_posts:
            md_lines.append("\n💬 **Reddit热点**\n")
            # 按版块分组
            by_subreddit = {}
            for post in reddit_posts:
                subreddit = post.extra_data.get("subreddit", "Reddit") if post.extra_data else "Reddit"
                if subreddit not in by_subreddit:
                    by_subreddit[subreddit] = []
                by_subreddit[subreddit].append(post)

            # 遍历每个版块
            for subreddit, posts in by_subreddit.items():
                md_lines.append(f"\n**r/{subreddit}**\n")
                for post in posts:
                    title = post.title_zh or post.title or post.content[:100] or "无标题"
                    md_lines.append(f"- {title}\n{post.post_url or ''}\n")

            md_lines.append("\n---\n\n")

        # TikTok热点
        if tiktok_posts:
            md_lines.append("\n🎵 **TikTok热点**\n")
            for post in tiktok_posts:
                title = post.title_zh or post.title or post.content[:200] or "无标题"
                md_lines.append(f"- {title}\n{post.post_url or ''}\n")
            md_lines.append("\n---\n")

        return "".join(md_lines)

    def _generate_markdown_report(
        self,
        youtube_posts: List[SocialMediaPost],
        tiktok_posts: List[SocialMediaPost],
        twitter_posts: List[SocialMediaPost],
        report_date: datetime
    ) -> str:
        """
        生成Markdown格式的报告（保留原有格式作为备选）

        Args:
            youtube_posts: YouTube热帖列表
            tiktok_posts: TikTok热帖列表
            twitter_posts: Twitter热帖列表
            report_date: 报告日期

        Returns:
            Markdown格式的报告内容
        """
        # 使用新的热点小报格式
        return self._generate_hotspot_report(
            youtube_posts=youtube_posts,
            tiktok_posts=tiktok_posts,
            twitter_posts=twitter_posts,
            report_date=report_date
        )

    def _format_youtube_stats(self, post: SocialMediaPost) -> str:
        """格式化YouTube统计信息"""
        parts = []
        if post.view_count:
            parts.append(f"播放{self._format_number(post.view_count)}")
        if post.like_count:
            parts.append(f"点赞{self._format_number(post.like_count)}")
        if post.comment_count:
            parts.append(f"评论{self._format_number(post.comment_count)}")
        return " | ".join(parts)

    def _format_tiktok_stats(self, post: SocialMediaPost) -> str:
        """格式化TikTok统计信息"""
        parts = []
        if post.view_count:
            parts.append(f"播放{self._format_number(post.view_count)}")
        if post.like_count:
            parts.append(f"点赞{self._format_number(post.like_count)}")
        if post.comment_count:
            parts.append(f"评论{self._format_number(post.comment_count)}")
        if post.viral_score:
            parts.append(f"爆款指数{post.viral_score}")
        return " | ".join(parts)

    def _format_twitter_stats(self, post: SocialMediaPost) -> str:
        """格式化Twitter统计信息"""
        parts = []
        if post.view_count:
            parts.append(f"观看{self._format_number(post.view_count)}")
        if post.like_count:
            parts.append(f"点赞{self._format_number(post.like_count)}")
        if post.share_count:
            parts.append(f"转发{self._format_number(post.share_count)}")
        if post.comment_count:
            parts.append(f"回复{self._format_number(post.comment_count)}")
        if post.viral_score:
            parts.append(f"热度{self._format_number(int(post.viral_score))}")
        return " | ".join(parts)

    def _format_number(self, num: int) -> str:
        """格式化数字(添加单位)"""
        if num >= 1000000:
            return f"{num/1000000:.1f}M"
        elif num >= 1000:
            return f"{num/1000:.1f}K"
        return str(num)
