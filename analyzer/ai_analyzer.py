"""
AI内容分析器 - 使用OpenAI兼容接口
"""
import json
from typing import Dict, Any, List, Optional
from openai import OpenAI
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


class AIAnalyzer:
    """AI内容分析器"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4-turbo-preview",
        embedding_model: str = "text-embedding-3-small",
    ):
        try:
            # 初始化OpenAI客户端，只传递必需参数
            self.client = OpenAI(
                api_key=api_key,
                base_url=base_url,
                timeout=60.0,
                max_retries=2,
            )
            self.model = model
            self.embedding_model = embedding_model
            logger.info(f"✅ AI分析器初始化成功 (model: {model})")
        except Exception as e:
            logger.error(f"❌ AI分析器初始化失败: {e}")
            raise

    def analyze_article(self, article: Dict[str, Any]) -> Dict[str, Any]:
        """
        分析文章，生成总结和标签

        Args:
            article: 文章字典

        Returns:
            分析结果
        """
        try:
            logger.info(f"🤖 正在分析文章: {article['title'][:50]}...")

            # 准备分析内容
            content = self._prepare_content(article)

            # 调用LLM分析
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": self._get_system_prompt(),
                    },
                    {
                        "role": "user",
                        "content": self._get_user_prompt(content),
                    },
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
            )

            # 解析结果
            result_text = response.choices[0].message.content
            result = json.loads(result_text)

            logger.info(f"✅ 分析完成: {result.get('summary', '')[:50]}...")
            return result

        except Exception as e:
            logger.error(f"❌ AI分析失败: {e}")
            return self._get_default_analysis()

    def _prepare_content(self, article: Dict[str, Any]) -> str:
        """准备待分析的内容"""
        title = article.get("title", "")
        content = article.get("content", "")
        source = article.get("source", "")

        # 对于完整内容，使用更大的长度限制（8000字符）
        # 如果内容太长，截取前8000字符，但保留完整句子
        max_content_length = 8000
        if len(content) > max_content_length:
            # 尝试在句子边界截断
            truncated = content[:max_content_length]
            last_period = truncated.rfind('.')
            last_newline = truncated.rfind('\n')
            cut_point = max(last_period, last_newline)
            if cut_point > max_content_length * 0.8:  # 如果截断点不太靠前
                content = truncated[:cut_point + 1] + "..."
            else:
                content = truncated + "..."

        return f"""标题: {title}
来源: {source}
发布时间: {article.get('published_at', 'Unknown')}
正文: {content}"""

    def _get_system_prompt(self) -> str:
        """获取系统提示词"""
        return """你是一位AI研究领域的专家分析师。你的任务是分析AI相关的文章、论文和新闻，提供高质量的结构化分析。

**重要要求：所有输出内容必须使用中文（简体中文）。**

请按照JSON格式返回分析结果，包含以下字段：
{
  "summary": "3-5句话的核心总结，突出最重要的信息（必须用中文）",
  "key_points": ["关键点1", "关键点2", "关键点3", ...]（必须用中文）,
  "topics": ["主题1", "主题2", ...]（可以用英文技术术语，但尽量用中文）,
  "importance": "high/medium/low",
  "target_audience": "researcher/engineer/general/entrepreneur/investor",
  "tags": ["标签1", "标签2", ...]（可以用英文技术术语，但尽量用中文）,
  "technical_depth": "introductory/intermediate/advanced",
  "related_fields": ["相关领域1", "相关领域2", ...]（必须用中文）
}

评估标准：
- importance (high): 重大突破、新模型发布、业界重要动态、顶级会议论文
- importance (medium): 有价值的研究、技术改进、行业新闻
- importance (low): 一般性报道、简单介绍

- target_audience:
  - researcher: 面向学术研究者，包含详细技术细节
  - engineer: 面向工程师，包含实现细节和代码
  - general: 面向大众，通俗易懂
  - entrepreneur: 面向创业者，包含商业应用
  - investor: 面向投资者，包含市场前景

- topics: 大主题，如 ["自然语言处理", "计算机视觉", "强化学习", "AI安全"]

- tags: 具体标签，如 ["GPT-4", "Transformer", "微调", "大语言模型"]

**请确保所有文本内容（summary、key_points、related_fields等）都使用中文输出。技术术语可以保留英文，但描述性文字必须用中文。**"""

    def _get_user_prompt(self, content: str) -> str:
        """获取用户提示词"""
        return f"""请分析以下AI相关内容，返回结构化的JSON格式分析：

{content}

**重要：请使用中文（简体中文）输出所有文本内容，包括summary、key_points、related_fields等字段。技术术语可以保留英文，但描述性文字必须用中文。**

请按照要求的JSON格式返回分析结果。"""

    def _get_default_analysis(self) -> Dict[str, Any]:
        """获取默认分析结果（分析失败时使用）"""
        return {
            "summary": "AI分析暂时不可用",
            "key_points": [],
            "topics": [],
            "importance": "low",
            "target_audience": "general",
            "tags": [],
            "technical_depth": "introductory",
            "related_fields": [],
        }

    def batch_analyze(self, articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        批量分析文章

        Args:
            articles: 文章列表

        Returns:
            分析结果列表
        """
        results = []
        total = len(articles)

        for i, article in enumerate(articles, 1):
            logger.info(f"🤖 分析进度: {i}/{total}")
            result = self.analyze_article(article)
            results.append(result)

        return results

    def generate_daily_summary(self, articles: List[Dict[str, Any]], max_count: int = 10) -> str:
        """
        生成每日摘要

        Args:
            articles: 文章列表
            max_count: 最多包含文章数

        Returns:
            摘要文本
        """
        try:
            logger.info(f"📝 正在生成每日摘要...")

            # 筛选重要文章
            important_articles = [a for a in articles if a.get("importance") in ["high", "medium"]][:max_count]

            if not important_articles:
                return "今日暂无重要AI资讯"

            # 准备摘要内容
            articles_text = ""
            for i, article in enumerate(important_articles, 1):
                articles_text += f"""
{i}. 标题: {article.get('title', 'Unknown')}
   来源: {article.get('source', 'Unknown')}
   总结: {article.get('summary', article.get('content', '')[:200])}
   重要性: {article.get('importance', 'low')}
   主题: {', '.join(article.get('topics', []))}
"""

            # 调用LLM生成摘要
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": """你是一位专业的AI资讯编辑。请根据提供的重要AI资讯，生成一份简洁、有价值的每日摘要。

摘要格式要求：
1. 使用Markdown格式
2. 开头给出今日核心要点（3-5条）
3. 按主题分类展示重要资讯
4. 每条资讯包含标题、来源、核心价值
5. 语言简洁专业，适合快速阅读
6. 结尾可以给出趋势洞察（如果有）

保持摘要在800字以内。""",
                    },
                    {
                        "role": "user",
                        "content": f"""请为以下AI资讯生成每日摘要：

{articles_text}

请生成一份专业的每日摘要。""",
                    },
                ],
                temperature=0.5,
                max_tokens=2000,
            )

            summary = response.choices[0].message.content
            logger.info("✅ 每日摘要生成完成")
            return summary

        except Exception as e:
            logger.error(f"❌ 生成每日摘要失败: {e}")
            return f"每日摘要生成失败: {str(e)}"

    def get_embedding(self, text: str) -> List[float]:
        """
        获取文本的向量表示

        Args:
            text: 输入文本

        Returns:
            向量列表
        """
        try:
            response = self.client.embeddings.create(model=self.embedding_model, input=text)
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"❌ 获取向量失败: {e}")
            return []
