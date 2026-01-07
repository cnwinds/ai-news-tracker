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
        # 支持分别配置大模型和向量模型的提供商
        embedding_api_key: Optional[str] = None,
        embedding_api_base: Optional[str] = None,
    ):
        try:
            # 初始化大模型客户端
            self.client = OpenAI(
                api_key=api_key,
                base_url=base_url,
                timeout=60.0,
                max_retries=2,
            )
            self.model = model
            
            # 如果提供了独立的向量模型配置，使用独立的客户端
            if embedding_api_key and embedding_api_base:
                self.embedding_client = OpenAI(
                    api_key=embedding_api_key,
                    base_url=embedding_api_base,
                    timeout=60.0,
                    max_retries=2,
                )
                logger.info(f"✅ AI分析器初始化成功 (LLM: {model}, Embedding: {embedding_model} - 独立提供商)")
            else:
                # 否则使用同一个客户端
                self.embedding_client = self.client
                logger.info(f"✅ AI分析器初始化成功 (LLM: {model}, Embedding: {embedding_model} - 同一提供商)")
            
            self.embedding_model = embedding_model
        except Exception as e:
            logger.error(f"❌ AI分析器初始化失败: {e}")
            raise

    def analyze_article(self, article: Dict[str, Any] = None, custom_prompt: str = None, **kwargs) -> Dict[str, Any]:
        """
        分析文章，生成总结和标签

        Args:
            article: 文章字典（包含 title, content, source, published_at）
            或者使用关键字参数: title, content, url
            custom_prompt: 自定义提示词模板（可选），如果提供则使用自定义提示词，否则使用默认提示词
                         支持变量替换：{title}, {content}, {source}, {url}

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
            
            # 构建提示词（如果提供了自定义提示词，使用自定义提示词）
            if custom_prompt:
                prompt = self._build_custom_prompt(custom_prompt, title, content, url, source)
            else:
                prompt = self._build_analysis_prompt(title, content, url, source)
            
            # 最多尝试3次（初始1次 + 重试2次）
            max_retries = 3
            result = None
            result_text = None
            
            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        logger.info(f"🔄 第 {attempt + 1} 次尝试解析AI响应...")
                    
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

                    # 检查JSON是否完整（以{开头，以}结尾）- 仅用于日志记录
                    if json_text and not json_text.startswith('{'):
                        logger.error(f"❌ JSON内容不完整：不是以 '{{' 开头")
                        logger.error(f"   前200字符: {json_text[:200]}")
                    elif json_text and not json_text.rstrip().endswith('}'):
                        logger.error(f"❌ JSON内容不完整：不是以 '}}' 结尾")
                        logger.error(f"   后200字符: {json_text[-200:]}")
                        logger.error(f"   完整长度: {len(json_text)}")

                    # 尝试解析JSON，如果格式不正确会自动抛出JSONDecodeError
                    result = json.loads(json_text)
                    logger.info(f"✅ JSON解析成功（第 {attempt + 1} 次尝试）")

                    # 确保 result 是字典类型
                    if not isinstance(result, dict):
                        logger.warning(f"⚠️  JSON解析结果不是字典类型，使用文本解析: {type(result)}")
                        result = self._parse_text_response(result_text)
                    
                    # 解析成功，跳出循环
                    break
                    
                except json.JSONDecodeError as e:
                    # JSON解析失败
                    logger.error(f"❌ 第 {attempt + 1} 次尝试JSON解析失败: {e}")
                    if attempt < max_retries - 1:
                        logger.warning(f"⚠️  将进行第 {attempt + 2} 次重试...")
                        # 继续下一次循环
                        continue
                    else:
                        # 3次都失败了，使用文本解析作为后备方案
                        logger.error(f"❌ 3次尝试均失败，使用文本解析作为后备方案")
                        logger.error(f"   响应内容前500字符:\n{result_text[:500] if result_text else '无响应'}")
                        logger.error(f"   响应内容后200字符:\n{result_text[-200:] if result_text else '无响应'}")
                        logger.error(f"   完整响应长度: {len(result_text) if result_text else 0} 字符")
                        result = self._parse_text_response(result_text) if result_text else self._parse_text_response("")
                except Exception as e:
                    # 其他异常（如API调用失败）
                    logger.error(f"❌ 第 {attempt + 1} 次尝试失败: {e}")
                    if attempt < max_retries - 1:
                        logger.warning(f"⚠️  将进行第 {attempt + 2} 次重试...")
                        # 继续下一次循环
                        continue
                    else:
                        # 3次都失败了，抛出异常
                        raise
            
            # 确保所有必需字段存在
            result.setdefault("importance", "low")
            result.setdefault("topics", [])
            result.setdefault("tags", [])
            result.setdefault("key_points", [])
            result.setdefault("target_audience", "general")
            
            # 处理 summary 字段：确保是字符串类型
            if "summary" not in result or not result["summary"]:
                result["summary"] = result_text if result_text else ""  # 保存完整响应内容，方便后续研究问题
            else:
                # 确保 summary 是字符串，而不是其他类型
                summary_value = result["summary"]
                if isinstance(summary_value, dict):
                    # 如果是字典，转换为 JSON 字符串
                    result["summary"] = json.dumps(summary_value, ensure_ascii=False)
                elif not isinstance(summary_value, str):
                    # 如果不是字符串，转换为字符串
                    result["summary"] = str(summary_value) if summary_value else ""
            
            # 处理 title_zh 字段：如果AI返回了，使用AI的翻译；否则如果标题是英文，单独翻译
            if result.get("title_zh"):
                # AI已经在分析时返回了翻译，直接使用
                logger.info(f"✅ AI已返回标题翻译: {result.get('title_zh')[:30]}...")
            elif title and self._is_english_title(title):
                # AI没有返回翻译，且标题是英文，单独翻译
                try:
                    title_zh = self.translate_title_with_context(title, content)
                    if title_zh and title_zh != title:
                        result["title_zh"] = title_zh
                        logger.info(f"✅ 标题翻译完成: {title[:30]}... -> {title_zh[:30]}...")
                except Exception as e:
                    logger.warning(f"⚠️  标题翻译失败: {e}")
            
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

    def translate_title_with_context(self, title: str, content: str = "") -> str:
        """
        根据内容和标题翻译标题为中文
        
        Args:
            title: 原标题
            content: 文章内容（用于上下文理解）
            
        Returns:
            翻译后的中文标题
        """
        try:
            if not title:
                return title
            
            # 提取内容的前2000字符作为上下文
            content_preview = content[:2000] if content else ""
            
            prompt = f"""请根据文章标题和内容，将标题翻译成准确、自然的中文标题。

标题: {title}
{f"文章内容预览: {content_preview}" if content_preview else ""}

要求：
1. 翻译要准确、自然，符合中文表达习惯
2. 如果是技术术语，使用通用的中文翻译
3. 只返回翻译后的中文标题，不要添加任何解释或说明
4. 保持标题的简洁性和吸引力

中文标题："""
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的翻译助手，擅长根据文章内容准确翻译技术文章标题。"
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
            # 去除可能的引号
            translated = translated.strip('"').strip("'").strip()
            return translated
            
        except Exception as e:
            logger.warning(f"⚠️  标题翻译失败: {e}")
            return title

    def _is_english_title(self, title: str) -> bool:
        """
        判断标题是否为英文
        
        Args:
            title: 标题
            
        Returns:
            是否为英文标题
        """
        if not title:
            return False
        
        # 简单的判断：如果标题中大部分字符是英文字母、数字或常见英文标点，则认为是英文
        # 如果包含中文字符，则不是英文
        import re
        # 检查是否包含中文字符
        if re.search(r'[\u4e00-\u9fff]', title):
            return False
        
        # 检查是否主要是英文字母、数字和常见标点
        english_chars = re.findall(r'[a-zA-Z0-9\s\.,;:!?\'"\-()\[\]{}]', title)
        english_ratio = len(english_chars) / len(title) if title else 0
        
        # 如果英文字符占比超过70%，认为是英文标题
        return english_ratio > 0.7

    def _build_custom_prompt(self, template: str, title: str, content: str, url: str = "", source: str = "") -> str:
        """
        使用自定义模板构建提示词
        
        Args:
            template: 提示词模板，支持变量：{title}, {content}, {source}, {url}
            title: 文章标题
            content: 文章内容
            url: 文章URL
            source: 来源名称
        
        Returns:
            替换变量后的提示词
        """
        # 限制内容长度（避免超出token限制）
        content_preview = content[:8000] if content else "无内容"
        
        # 使用str.format进行变量替换
        try:
            prompt = template.format(
                title=title,
                content=content_preview,
                source=source,
                url=url
            )
            return prompt
        except KeyError as e:
            logger.warning(f"⚠️  提示词模板包含未知变量: {e}，使用默认提示词")
            return self._build_analysis_prompt(title, content, url, source)
        except Exception as e:
            logger.warning(f"⚠️  构建自定义提示词失败: {e}，使用默认提示词")
            return self._build_analysis_prompt(title, content, url, source)

    def _build_analysis_prompt(self, title: str, content: str, url: str = "", source: str = "") -> str:
        """构建分析提示词（默认）"""
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
    "summary": "文章摘要（将原文改写成结构完整、信息齐全、逻辑严密的精简短文，最长800字，使用Markdown格式输出，可以使用标题、列表、加粗等Markdown语法，换行使用 \n 表示）",
    "topics": ["主题1", "主题2", "主题3"],
    "tags": ["标签1", "标签2", "标签3"],
    "key_points": ["关键点1", "关键点2", "关键点3"],
    "target_audience": "researcher/engineer/general",
    "related_papers": ["相关论文1", "相关论文2"],
    "title_zh": "如果文章标题是英文，请将其翻译成准确、自然的中文标题；如果标题已经是中文，则不输出该行"
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

    def generate_embedding(self, text: str) -> List[float]:
        """
        生成文本的嵌入向量

        Args:
            text: 要生成嵌入向量的文本

        Returns:
            嵌入向量列表
        """
        try:
            if not text or not text.strip():
                logger.warning("⚠️  生成嵌入向量时文本为空")
                return []
            
            # 调用OpenAI Embeddings API（使用独立的向量模型客户端）
            response = self.embedding_client.embeddings.create(
                model=self.embedding_model,
                input=text.strip()
            )
            
            embedding = response.data[0].embedding
            logger.debug(f"✅ 生成嵌入向量成功，维度: {len(embedding)}")
            return embedding
            
        except Exception as e:
            logger.error(f"❌ 生成嵌入向量失败: {e}")
            raise

    def _parse_text_response(self, text: str) -> Dict[str, Any]:
        """解析文本响应（当API返回的不是JSON时）"""
        result = {
            "importance": "medium",
            "summary": text,  # 保存完整响应内容，方便后续研究问题
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

