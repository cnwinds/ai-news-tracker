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

    def analyze_article(self, article: Dict[str, Any] = None, **kwargs) -> Dict[str, Any]:
        """
        分析文章，生成总结和标签

        Args:
            article: 文章字典（包含 title, content, source, published_at）
            或者使用关键字参数: title, content, url

        Returns:
            分析结果
        """
        # 支持两种调用方式：字典参数或关键字参数
        if article is None and kwargs:
            article = kwargs
        elif article is None:
            article = {}
        
        try:
            title = article.get("title", "")
            content = article.get("content", "")
            url = article.get("url", "")
            source = article.get("source", "")
            
            logger.info(f"🤖 正在分析文章: {title[:50]}...")
            
            # 构建提示词
            prompt = self._build_analysis_prompt(title, content, url, source)
            
            # 调用OpenAI API
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的内容改写专家，擅长将长篇文章改写成结构完整、信息齐全、逻辑严密的精简短文。你的任务是提取文章的核心思想，为时间宝贵的核心读者（如投资人、合作伙伴、高级决策者）准备浓缩精华版，使其成为一篇独立、完整、且有说服力的作品。请使用中文输出所有内容。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=4000,  # 增加token限制以支持更详细的摘要（最长800字）
            )
            
            # 解析响应
            result_text = response.choices[0].message.content.strip()

            logger.info(f"📦 AI原始响应长度: {len(result_text)} 字符")

            # 尝试解析JSON响应
            try:
                # 处理可能包含 ```json 标记的情况
                json_text = result_text
                if result_text.startswith('```'):
                    # 提取JSON部分（去除 ```json 和 ``` 标记）
                    lines = result_text.split('\n')
                    json_lines = []
                    started = False
                    for line in lines:
                        if line.strip().startswith('```'):
                            if not started:
                                started = True
                                continue
                            else:
                                break
                        if started:
                            json_lines.append(line)
                    json_text = '\n'.join(json_lines)
                    logger.info(f"✂️  去除Markdown标记后长度: {len(json_text)} 字符")

                # 检查JSON是否完整（以{开头，以}结尾）
                if json_text and not json_text.startswith('{'):
                    logger.error(f"❌ JSON内容不完整：不是以 '{{' 开头")
                    logger.error(f"   前200字符: {json_text[:200]}")
                elif json_text and not json_text.rstrip().endswith('}'):
                    logger.error(f"❌ JSON内容不完整：不是以 '}}' 结尾")
                    logger.error(f"   后200字符: {json_text[-200:]}")
                    logger.error(f"   完整长度: {len(json_text)}")

                result = json.loads(json_text)
                logger.info(f"✅ JSON解析成功")

                # 确保 result 是字典类型
                if not isinstance(result, dict):
                    logger.warning(f"⚠️  JSON解析结果不是字典类型，使用文本解析: {type(result)}")
                    result = self._parse_text_response(result_text)
            except json.JSONDecodeError as e:
                # 如果不是JSON格式，尝试提取关键信息
                logger.error(f"❌ JSON解析失败: {e}")
                logger.error(f"   响应内容前500字符:\n{result_text[:500]}")
                logger.error(f"   响应内容后200字符:\n{result_text[-200:]}")
                logger.error(f"   完整响应长度: {len(result_text)} 字符")
                result = self._parse_text_response(result_text)
            
            # 确保所有必需字段存在
            result.setdefault("importance", "low")
            result.setdefault("topics", [])
            result.setdefault("tags", [])
            result.setdefault("key_points", [])
            result.setdefault("target_audience", "general")
            
            # 处理 summary 字段：确保是字符串类型
            if "summary" not in result or not result["summary"]:
                result["summary"] = result_text[:500] if result_text else ""
            else:
                # 确保 summary 是字符串，而不是其他类型
                summary_value = result["summary"]
                if isinstance(summary_value, dict):
                    # 如果是字典，转换为 JSON 字符串
                    result["summary"] = json.dumps(summary_value, ensure_ascii=False)
                elif not isinstance(summary_value, str):
                    # 如果不是字符串，转换为字符串
                    result["summary"] = str(summary_value) if summary_value else ""
            
            logger.info(f"✅ 文章分析完成: {title[:50]}...")
            return result
            
        except Exception as e:
            logger.error(f"❌ 文章分析失败: {e}")
            raise

    def translate_title(self, title: str, target_language: str = "zh") -> str:
        """
        翻译标题

        Args:
            title: 原标题
            target_language: 目标语言（默认中文）

        Returns:
            翻译后的标题
        """
        try:
            if not title:
                return title
            
            prompt = f"请将以下标题翻译成{target_language}，只返回翻译结果，不要添加任何解释：\n\n{title}"
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的翻译助手，擅长翻译技术文章标题。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=200,
            )
            
            translated = response.choices[0].message.content.strip()
            return translated
            
        except Exception as e:
            logger.warning(f"⚠️  标题翻译失败: {e}")
            return title

    def _build_analysis_prompt(self, title: str, content: str, url: str = "", source: str = "") -> str:
        """构建分析提示词"""
        content_preview = content[:8000] if content else "无内容"
        
        prompt = f"""将作者写的长篇文章，改写成一篇**结构完整、信息齐全、逻辑严密**的精简短文。想象一下，这是为那些时间极其宝贵但又必须掌握你思想精华的核心读者（比如投资人、合作伙伴、高级决策者）准备的"浓缩精华版"。它本身就是一篇独立、完整、且有说服力的作品。

**重要：请使用中文输出所有内容。**

文章标题: {title}
来源: {source}
URL: {url}

文章内容:
{content_preview}

请按以下JSON格式返回分析结果：
{{
    "importance": "high/medium/low",
    "summary": "文章摘要（将原文改写成结构完整、信息齐全、逻辑严密的精简短文，最长800字，使用Markdown格式输出，可以使用标题、列表、加粗等Markdown语法）",
    "topics": ["主题1", "主题2", "主题3"],
    "tags": ["标签1", "标签2", "标签3"],
    "key_points": ["关键点1", "关键点2", "关键点3"],
    "target_audience": "researcher/engineer/general",
    "related_papers": ["相关论文1", "相关论文2"]
}}

**重要提示：summary字段必须使用Markdown格式输出，可以使用以下Markdown语法：**
- 标题：使用 #、##、### 等
- 列表：使用 - 或 * 
- 加粗：使用 **文本**
- 强调：使用 *文本*
- 代码：使用 `代码`

重要性评估标准：
- high: 重大突破、重要研究、行业影响大
- medium: 有价值的技术进展、值得关注
- low: 一般性内容、信息量较少

请确保返回有效的JSON格式。"""
        
        return prompt

    def _parse_text_response(self, text: str) -> Dict[str, Any]:
        """解析文本响应（当API返回的不是JSON时）"""
        result = {
            "importance": "medium",
            "summary": text[:500],
            "topics": [],
            "tags": [],
            "key_points": [],
            "target_audience": "general",
        }
        
        # 尝试从文本中提取信息
        lines = text.split("\n")
        for line in lines:
            if "重要性" in line or "importance" in line.lower():
                if "高" in line or "high" in line.lower():
                    result["importance"] = "high"
                elif "中" in line or "medium" in line.lower():
                    result["importance"] = "medium"
                elif "低" in line or "low" in line.lower():
                    result["importance"] = "low"
        
        return result

