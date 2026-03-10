"""
AI内容分析器 - 使用OpenAI兼容接口，支持 /v1/responses 新协议
"""
import json
from types import SimpleNamespace
from typing import Dict, Any, List, Optional, Iterator, Union
from openai import OpenAI
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


def _responses_create(client: OpenAI, model: str, messages: List[Dict[str, Any]], **kwargs: Any) -> Any:
    """
    使用 Responses API (/v1/responses) 创建完成，返回兼容 chat.completions 的封装。
    当服务端仅支持新协议时使用。
    """
    # 某些提供商（如 GLM、第三方 OpenAI 兼容接口）可能不支持 max_output_tokens
    # 需要兼容不同的参数名
    max_tokens_value = kwargs.get("max_tokens", 4000)

    # 构建基础参数
    params: Dict[str, Any] = {
        "model": model,
        "input": messages,
        "temperature": kwargs.get("temperature", 0.3),
    }

    if "response_format" in kwargs:
        params["text"] = {"format": kwargs["response_format"]}
    extra = {k: v for k, v in kwargs.items() if k not in ("temperature", "max_tokens", "response_format")}
    params.update(extra)
    params.pop("max_tokens", None)  # 移除原始参数

    # 尝试不同的参数名
    for param_name in ["max_output_tokens", "max_tokens", None]:
        try:
            if param_name is not None:
                params[param_name] = max_tokens_value
            return client.responses.create(**params)
        except TypeError as e:
            error_msg = str(e).lower()
            # 检查是否是参数错误
            if "unexpected keyword argument" in error_msg:
                # 移除刚添加的参数，继续尝试下一个
                params.pop(param_name, None)
                logger.warning(f"Responses API 不支持 {param_name}，尝试其他参数名: {e}")
                continue
            raise


def _responses_output_text(response: Any) -> str:
    """从 Responses API 响应中提取完整文本（兼容 output_text 或 output 列表）。"""
    if hasattr(response, "output_text") and response.output_text is not None:
        return response.output_text
    if hasattr(response, "output") and response.output:
        parts = []
        for item in response.output:
            if isinstance(item, dict):
                if item.get("type") == "message" and "content" in item:
                    for c in item["content"] or []:
                        if isinstance(c, dict) and c.get("type") == "text":
                            parts.append(c.get("text", ""))
                elif item.get("type") == "output_text" and "text" in item:
                    parts.append(item["text"])
            elif hasattr(item, "type"):
                if getattr(item, "type", None) == "message" and getattr(item, "content", None):
                    for c in item.content or []:
                        if getattr(c, "type", None) == "text":
                            parts.append(getattr(c, "text", ""))
        return "".join(parts)
    return ""


def _wrap_response_as_chat(response: Any) -> Any:
    """将 Responses API 的响应封装成 chat.completions 兼容结构：choices[0].message.content"""
    text = _responses_output_text(response)
    msg = SimpleNamespace(content=text or "", role="assistant")
    choice = SimpleNamespace(message=msg, index=0, finish_reason="stop")
    return SimpleNamespace(choices=[choice], usage=getattr(response, "usage", None))


def _stream_responses_as_chat(stream: Iterator[Any]) -> Iterator[Any]:
    """
    将 Responses API 流式事件转换为 chat.completions 流式 chunk：choices[0].delta.content。
    兼容 SDK 事件类型 response.output_text.delta（ResponseTextDeltaEvent 含 type/delta）。
    """
    for event in stream:
        content = None
        ev_type = event.get("type", "") if isinstance(event, dict) else getattr(event, "type", "")
        if ev_type and "output_text.delta" in ev_type:
            content = event.get("delta") if isinstance(event, dict) else (getattr(event, "delta", None) or getattr(event, "text", None))
        if content is None and hasattr(event, "delta") and isinstance(getattr(event, "delta", None), str):
            content = event.delta
        if content:
            delta = SimpleNamespace(content=content)
            choice = SimpleNamespace(delta=delta, index=0)
            yield SimpleNamespace(choices=[choice])


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

    def create_completion(
        self,
        messages: List[Dict[str, Any]],
        *,
        model: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 4000,
        stream: bool = False,
        **kwargs: Any,
    ) -> Union[Any, Iterator[Any]]:
        """
        使用 /v1/responses 协议创建完成，返回与 chat.completions 兼容的结构。
        调用方仍可使用 result.choices[0].message.content 获取文本。
        """
        use_model = model or self.model
        if stream:
            params = {
                "model": use_model,
                "input": messages,
                "temperature": temperature,
                "max_output_tokens": max_tokens,
                "stream": True,
                **kwargs,
            }
            if "response_format" in params:
                params["text"] = {"format": params.pop("response_format")}
            params.pop("max_tokens", None)  # Responses API 仅接受 max_output_tokens
            stream_iter = self.client.responses.create(**params)
            return _stream_responses_as_chat(stream_iter)
        resp = _responses_create(
            self.client, use_model, messages,
            temperature=temperature, max_tokens=max_tokens, **kwargs
        )
        return _wrap_response_as_chat(resp)

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
            category = article.get("category", "")

            # 判断是否为邮件类型
            is_email = category == "email" or "email" in source.lower() or url.startswith("mailto:")

            # 智能判断是否需要AI总结
            should_summarize = self._should_use_ai_summary(content)
            language = self._detect_content_language(content)

            if not should_summarize:
                # 内容较短，直接使用或翻译
                logger.info(f"📝 内容较短，直接使用{'并翻译' if language == 'en' else ''}: {title[:50]}...")
                return self._handle_short_content(title, content, language)

            logger.info(f"🤖 正在分析文章: {title[:50]}...")
            
            # 构建提示词（如果提供了自定义提示词，使用自定义提示词）
            prompt = self._build_analysis_prompt(title, content, url, source, custom_task_description=custom_prompt, is_email=is_email)
            
            # 最多尝试3次（初始1次 + 重试2次）
            max_retries = 3
            result = None
            result_text = None
            
            for attempt in range(max_retries):
                try:
                    if attempt > 0:
                        logger.info(f"🔄 第 {attempt + 1} 次尝试解析AI响应...")
                    
                    # 对于邮件，增加token限制以支持更长的输出
                    max_tokens = 8000 if is_email else 4000
                    
                    # 使用 /v1/responses 协议
                    response = self.create_completion(
                        [
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
                        max_tokens=max_tokens,  # 邮件使用8000，其他使用4000
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
                    error_msg = str(e)

                    # 检查是否是请求体过大错误
                    if "Exceeded limit on max bytes to request body" in error_msg or "6291456" in error_msg:
                        logger.error(f"❌ 第 {attempt + 1} 次尝试失败: 请求体过大（超过 6MB 限制）")
                        logger.error(f"   标题: {title[:100]}")
                        logger.error(f"   URL: {url[:100]}")
                        logger.error(f"   内容长度: {len(content)} 字符")
                        logger.error(f"   提示词长度: {len(prompt)} 字符")
                        # 计算估算的请求体大小（UTF-8编码）
                        estimated_size = len(prompt.encode('utf-8')) + 1000
                        logger.error(f"   估算请求体大小: {estimated_size} 字节")

                    if "Exceeded limit on max bytes to request body" in error_msg:
                        logger.error(f"❌ API错误详情: {error_msg}")

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
            result.setdefault("tags", [])
            result.setdefault("target_audience", "general")
            
            # 处理 detailed_summary 字段（精读）：确保是字符串类型
            if "detailed_summary" not in result or not result["detailed_summary"]:
                # 如果新字段不存在，检查是否有旧的 summary 字段（向后兼容）
                if "summary" in result and result["summary"]:
                    result["detailed_summary"] = result["summary"]
                else:
                    result["detailed_summary"] = result_text if result_text else ""  # 保存完整响应内容，方便后续研究问题
            else:
                # 确保 detailed_summary 是字符串，而不是其他类型
                detailed_summary_value = result["detailed_summary"]
                if isinstance(detailed_summary_value, dict):
                    # 如果是字典，转换为 JSON 字符串
                    result["detailed_summary"] = json.dumps(detailed_summary_value, ensure_ascii=False)
                elif not isinstance(detailed_summary_value, str):
                    # 如果不是字符串，转换为字符串
                    result["detailed_summary"] = str(detailed_summary_value) if detailed_summary_value else ""
            
            # 处理 summary 字段（3句话摘要）：确保是字符串类型
            if "summary" not in result or not result["summary"]:
                result["summary"] = ""  # 如果没有生成摘要，使用空字符串
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

    def _should_use_ai_summary(self, content: str) -> bool:
        """
        判断是否需要使用AI进行总结

        Args:
            content: 文章内容

        Returns:
            True表示需要AI总结，False表示直接使用内容
        """
        if not content:
            return False

        language = self._detect_content_language(content)

        if language == 'en':
            # 英文：按单词数计算（大约200个单词）
            words = content.split()
            return len(words) > 200
        else:
            # 中文：按字符数计算（200个字）
            # 移除空格和换行符
            clean_content = content.replace(' ', '').replace('\n', '').replace('\r', '').replace('\t', '')
            return len(clean_content) > 200

    def _detect_content_language(self, content: str) -> str:
        """
        检测内容的主要语言

        Args:
            content: 文章内容

        Returns:
            'zh' 表示中文，'en' 表示英文
        """
        if not content:
            return 'en'

        import re
        # 检查中文字符
        chinese_chars = re.findall(r'[\u4e00-\u9fff]', content)
        chinese_ratio = len(chinese_chars) / len(content) if content else 0

        # 如果中文字符占比超过30%，认为是中文内容
        if chinese_ratio > 0.3:
            return 'zh'
        else:
            return 'en'

    def _handle_short_content(self, title: str, content: str, language: str) -> Dict[str, Any]:
        """
        处理较短的内容：直接使用或翻译

        Args:
            title: 文章标题
            content: 文章内容
            language: 内容语言 ('zh' 或 'en')

        Returns:
            分析结果字典
        """
        result = {
            "importance": "low",  # 短内容默认低重要性
            "tags": [],
            "target_audience": "general",
        }

        if language == 'en':
            # 英文内容，需要翻译成中文
            try:
                logger.info(f"🌐 正在翻译英文内容...")
                translated = self._translate_content_to_chinese(content)
                result["detailed_summary"] = translated
                # 对于短内容，摘要和精读使用相同内容
                result["summary"] = translated
            except Exception as e:
                logger.warning(f"⚠️  翻译失败，使用原文: {e}")
                result["detailed_summary"] = content
                result["summary"] = content
        else:
            # 中文内容，直接使用
            result["detailed_summary"] = content
            # 对于短内容，摘要和精读使用相同内容
            result["summary"] = content

        # 如果标题是英文，翻译标题
        if title and self._is_english_title(title):
            try:
                title_zh = self.translate_title_with_context(title, content)
                if title_zh and title_zh != title:
                    result["title_zh"] = title_zh
            except Exception as e:
                logger.warning(f"⚠️  标题翻译失败: {e}")

        return result

    def _translate_content_to_chinese(self, content: str) -> str:
        """
        将英文内容翻译成中文

        Args:
            content: 英文内容

        Returns:
            中文翻译
        """
        try:
            # 截断过长的内容（保留前3000字符）
            content_preview = content[:3000] if len(content) > 3000 else content

            prompt = f"""请将以下文章内容翻译成准确、自然的中文。

要求：
1. 翻译要准确、流畅，符合中文表达习惯
2. 保持原文的语气和风格
3. 如果是技术内容，使用通用的中文技术术语
4. 只返回翻译后的中文内容，不要添加任何解释

英文内容：
{content_preview}

中文翻译："""

            response = self.create_completion(
                [
                    {"role": "system", "content": "你是一个专业的翻译助手，擅长准确翻译技术文章内容。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=4000,
            )
            translated = response.choices[0].message.content.strip()
            return translated

        except Exception as e:
            logger.warning(f"⚠️  内容翻译失败: {e}")
            return content

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
            response = self.create_completion(
                [
                    {"role": "system", "content": "你是一个专业的翻译助手，擅长翻译技术文章标题。"},
                    {"role": "user", "content": prompt}
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
            
            response = self.create_completion(
                [
                    {"role": "system", "content": "你是一个专业的翻译助手，擅长根据文章内容准确翻译技术文章标题。"},
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

    def _build_analysis_prompt(self, title: str, content: str, url: str = "", source: str = "", custom_task_description: str = None, is_email: bool = False) -> str:
        """
        构建分析提示词（整合自定义和默认提示词）

        Args:
            title: 文章标题
            content: 文章内容
            url: 文章URL
            source: 来源名称
            custom_task_description: 自定义任务描述模板（可选），支持变量：{title}, {content}, {source}, {url}
                                    如果提供则使用自定义描述，否则使用默认描述
            is_email: 是否为邮件类型（邮件支持更长的内容）

        Returns:
            完整的提示词（包含任务描述和JSON格式要求）
        """
        # 智能截断内容，避免超过 API 请求体大小限制
        # DashScope API 限制: 6MB (约 300万中文字符或 150万英文单词)
        # 实际使用中设置为 50万字符作为安全阈值（约 1MB）
        MAX_CONTENT_LENGTH = 500000  # 邮件类型
        MAX_CONTENT_LENGTH_SHORT = 100000  # 普通类型

        if not content:
            content_preview = "无内容"
        else:
            # 根据类型选择最大长度
            max_length = MAX_CONTENT_LENGTH if is_email else MAX_CONTENT_LENGTH_SHORT

            if len(content) > max_length:
                logger.warning(f"⚠️  内容过长 ({len(content)} 字符)，截断至 {max_length} 字符")
                content_preview = content[:max_length] + "\n\n[注: 内容过长，已截断]"
            else:
                content_preview = content
        
        # JSON格式要求部分（两个函数共用）
        json_format_section = """

请按以下JSON格式返回分析结果：
{{
    "importance": "high/medium/low",
    "detailed_summary": "根据上述要求处理后的内容（使用Markdown格式输出，可以使用标题、列表、加粗等Markdown语法，换行使用 \\n 表示）。这是精读版本，要求结构完整、信息齐全、逻辑严密。",
    "summary": "使用最多3句话总结文章的核心内容，要求简洁明了、突出重点。",
    "tags": ["标签1", "标签2", "标签3"],
    "target_audience": "researcher/engineer/general",
    "title_zh": "如果文章标题是英文，请将其翻译成准确、自然的中文标题；如果标题已经是中文，则不输出该行"
}}

**重要提示：**
1. detailed_summary字段（精读）：
   - 这是详细的精读版本，要求结构完整、信息齐全、逻辑严密
   - 必须使用Markdown格式输出，可以使用以下Markdown语法：
     * 标题：使用 #、##、### 等
     * 列表：使用 - 或 * 
     * 加粗：使用 **文本**
     * 强调：使用 *文本*
     * 代码：使用 `代码`
   - 内容应该详细、完整，可以包含多个段落和结构化的信息

2. summary字段（摘要）：
   - 这是简短的摘要版本，要求使用最多3句话总结文章的核心内容
   - 不需要Markdown格式，直接使用普通文本即可
   - 要求简洁明了、突出重点，只包含最核心的信息
   - 内容应该比detailed_summary短得多，通常只有1-3句话

**关键要求：summary和detailed_summary必须是不同的内容！summary是简短摘要（1-3句话），detailed_summary是详细精读（多段落、结构化）。请确保两个字段的内容长度和详细程度有明显区别。**

重要性评估标准：
- high: 重大突破、重要研究、行业影响大
- medium: 有价值的技术进展、值得关注
- low: 一般性内容、信息量较少

请确保返回有效的JSON格式。"""
        
        # 构建任务描述部分
        if custom_task_description:
            # 使用自定义任务描述
            try:
                task_description = custom_task_description.format(
                    title=title,
                    content=content_preview,
                    source=source,
                    url=url
                )
            except KeyError as e:
                logger.warning(f"⚠️  提示词模板包含未知变量: {e}，使用默认提示词")
                # 回退到默认描述
                task_description = self._get_default_task_description(title, content_preview, url, source)
            except Exception as e:
                logger.warning(f"⚠️  构建自定义提示词失败: {e}，使用默认提示词")
                # 回退到默认描述
                task_description = self._get_default_task_description(title, content_preview, url, source)
        else:
            # 使用默认任务描述
            task_description = self._get_default_task_description(title, content_preview, url, source)
        
        # 整合任务描述和JSON格式要求
        prompt = task_description + json_format_section
        return prompt
    
    def _get_default_task_description(self, title: str, content_preview: str, url: str = "", source: str = "") -> str:
        """
        获取默认的任务描述
        
        Args:
            title: 文章标题
            content_preview: 文章内容预览
            url: 文章URL
            source: 来源名称
        
        Returns:
            默认任务描述文本
        """
        return f"""将作者写的长篇文章，改写成一篇**结构完整、信息齐全、逻辑严密**的精简短文。想象一下，这是为那些时间极其宝贵但又必须掌握你思想精华的核心读者（比如投资人、合作伙伴、高级决策者）准备的"浓缩精华版"。它本身就是一篇独立、完整、且有说服力的作品。**记住仅只用文章内容进行总结，不要增加任何推断，严格遵循文章原始内容。**

**重要：请使用中文输出所有内容。**

文章标题: {title}
来源: {source}
URL: {url}

文章内容:
{content_preview}
"""
    
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
            "detailed_summary": text,  # 保存完整响应内容，方便后续研究问题
            "summary": "",  # 如果没有解析出摘要，使用空字符串
            "tags": [],
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

