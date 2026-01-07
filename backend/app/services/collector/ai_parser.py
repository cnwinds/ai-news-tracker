"""
AI自动解析修复器
当采集失败时，使用AI分析源数据并自动更新解析配置
"""
import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime

from backend.app.services.analyzer.ai_analyzer import AIAnalyzer
from backend.app.services.collector.web_collector import WebCollector
from backend.app.services.collector.rss_collector import RSSCollector
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class AIParser:
    """AI自动解析修复器"""

    def __init__(self, ai_analyzer: AIAnalyzer):
        self.ai_analyzer = ai_analyzer
        self.web_collector = WebCollector()
        self.rss_collector = RSSCollector()

    def analyze_and_fix_config(
        self,
        source_config: Dict[str, Any],
        raw_data: Optional[str] = None,
        error_message: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        分析源数据并生成新的解析配置

        Args:
            source_config: 源配置字典（包含name, url, source_type, extra_config等）
            raw_data: 原始数据（HTML/JSON/XML等），如果为None则自动获取
            error_message: 错误信息（可选）

        Returns:
            修复结果字典，包含：
                - success: 是否成功
                - new_config: 新的配置（如果成功）
                - error: 错误信息（如果失败）
                - fix_history_entry: 修复历史记录
        """
        source_name = source_config.get("name", "Unknown")
        source_type = source_config.get("source_type", "web")
        url = source_config.get("url", "")

        logger.info(f"🔧 开始AI自动修复: {source_name} (类型: {source_type})")

        try:
            # 如果没有提供原始数据，尝试获取
            if not raw_data:
                raw_data = self._fetch_raw_data(source_config)
                if not raw_data:
                    return {
                        "success": False,
                        "error": "无法获取原始数据",
                        "fix_history_entry": None
                    }

            # 根据源类型选择不同的修复策略
            if source_type == "web":
                new_config = self._fix_web_config(source_config, raw_data, error_message)
            elif source_type == "rss":
                new_config = self._fix_rss_config(source_config, raw_data, error_message)
            else:
                return {
                    "success": False,
                    "error": f"不支持的源类型: {source_type}",
                    "fix_history_entry": None
                }

            # 验证新配置
            if not self._validate_config(source_config, new_config):
                return {
                    "success": False,
                    "error": "新配置验证失败",
                    "fix_history_entry": None
                }

            # 创建修复历史记录
            fix_history_entry = {
                "timestamp": datetime.now().isoformat(),
                "old_config": source_config.get("extra_config", ""),
                "new_config": json.dumps(new_config, ensure_ascii=False) if isinstance(new_config, dict) else str(new_config),
                "error_message": error_message,
                "success": True
            }

            logger.info(f"✅ AI修复成功: {source_name}")
            return {
                "success": True,
                "new_config": new_config,
                "error": None,
                "fix_history_entry": fix_history_entry
            }

        except Exception as e:
            logger.error(f"❌ AI修复失败: {source_name}, 错误: {e}")
            fix_history_entry = {
                "timestamp": datetime.now().isoformat(),
                "old_config": source_config.get("extra_config", ""),
                "new_config": None,
                "error_message": str(e),
                "success": False
            }
            return {
                "success": False,
                "error": str(e),
                "fix_history_entry": fix_history_entry
            }

    def _fetch_raw_data(self, source_config: Dict[str, Any]) -> Optional[str]:
        """获取原始数据"""
        url = source_config.get("url", "")
        if not url:
            return None

        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            return response.text
        except Exception as e:
            logger.warning(f"⚠️  获取原始数据失败: {e}")
            return None

    def _fix_web_config(
        self,
        source_config: Dict[str, Any],
        html_content: str,
        error_message: Optional[str] = None
    ) -> Dict[str, Any]:
        """修复Web源配置"""
        source_name = source_config.get("name", "Unknown")
        url = source_config.get("url", "")
        old_config = source_config.get("extra_config", {})
        if isinstance(old_config, str):
            try:
                old_config = json.loads(old_config)
            except:
                old_config = {}

        # 构建AI提示词
        prompt = f"""你是一个网页解析专家。请分析以下HTML内容，找出文章列表、标题、链接、日期等元素的选择器。

网站URL: {url}
源名称: {source_name}
当前配置: {json.dumps(old_config, ensure_ascii=False) if old_config else "无"}
错误信息: {error_message if error_message else "无"}

HTML内容（前10000字符）:
{html_content[:10000]}

请分析HTML结构，找出：
1. 文章列表容器（article_selector）
2. 标题选择器（title_selector）
3. 链接选择器（link_selector）
4. 日期选择器（date_selector，可选）
5. 内容选择器（content_selector，可选）
6. 作者选择器（author_selector，可选）

请以JSON格式返回新的配置，格式如下：
{{
    "article_selector": "CSS选择器，用于选择文章列表项",
    "title_selector": "CSS选择器，用于选择标题（相对于article_selector）",
    "link_selector": "CSS选择器，用于选择链接（相对于article_selector）",
    "date_selector": "CSS选择器，用于选择日期（相对于article_selector，可选）",
    "content_selector": "CSS选择器，用于选择内容（可选）",
    "author_selector": "CSS选择器，用于选择作者（可选）",
    "fetch_full_content": true/false,
    "max_articles": 20
}}

只返回JSON，不要其他解释。"""

        # 调用AI分析
        response = self.ai_analyzer.client.chat.completions.create(
            model=self.ai_analyzer.model,
            messages=[
                {
                    "role": "system",
                    "content": "你是一个专业的网页解析专家，擅长分析HTML结构并生成CSS选择器。"
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.3,
            max_tokens=2000,
        )

        result_text = response.choices[0].message.content.strip()

        # 解析JSON响应
        if result_text.startswith('```'):
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
            result_text = '\n'.join(json_lines)

        new_config = json.loads(result_text)

        # 合并到旧配置（保留其他字段）
        if isinstance(old_config, dict):
            old_config.update(new_config)
            return old_config
        else:
            return new_config

    def _fix_rss_config(
        self,
        source_config: Dict[str, Any],
        xml_content: str,
        error_message: Optional[str] = None
    ) -> Dict[str, Any]:
        """修复RSS源配置（RSS通常不需要修复，但可以检查格式）"""
        # RSS源通常不需要修复，因为格式相对固定
        # 这里可以添加一些验证逻辑
        logger.info("ℹ️  RSS源通常不需要修复配置")
        return source_config.get("extra_config", {})

    def _validate_config(
        self,
        source_config: Dict[str, Any],
        new_config: Dict[str, Any]
    ) -> bool:
        """验证新配置是否有效"""
        source_type = source_config.get("source_type", "web")
        source_name = source_config.get("name", "Unknown")

        try:
            if source_type == "web":
                # 验证Web配置
                test_config = source_config.copy()
                # 合并新配置到extra_config
                if isinstance(new_config, dict):
                    test_config["extra_config"] = new_config
                    # 将extra_config中的字段合并到主配置
                    test_config.update(new_config)
                else:
                    test_config["extra_config"] = new_config

                # 尝试使用新配置解析
                articles = self.web_collector.fetch_articles(test_config)
                if articles and len(articles) > 0:
                    logger.info(f"✅ 配置验证成功: {source_name}，提取到 {len(articles)} 篇文章")
                    return True
                else:
                    logger.warning(f"⚠️  配置验证失败: {source_name}，未提取到文章")
                    return False
            else:
                # 其他类型暂时不验证
                return True

        except Exception as e:
            logger.warning(f"⚠️  配置验证异常: {source_name}, 错误: {e}")
            return False

    def update_source_config(
        self,
        db,
        source_id: int,
        new_config: Dict[str, Any],
        fix_history_entry: Dict[str, Any]
    ) -> bool:
        """
        更新源配置和修复历史

        Args:
            db: 数据库管理器
            source_id: 源ID
            new_config: 新配置
            fix_history_entry: 修复历史记录

        Returns:
            是否成功
        """
        try:
            with db.get_session() as session:
                from backend.app.db.models import RSSSource
                source = session.query(RSSSource).filter(RSSSource.id == source_id).first()
                if not source:
                    logger.error(f"❌ 源不存在: ID={source_id}")
                    return False

                # 更新extra_config
                if isinstance(new_config, dict):
                    source.extra_config = json.dumps(new_config, ensure_ascii=False)
                else:
                    source.extra_config = str(new_config)

                # 更新修复历史
                history = []
                if source.parse_fix_history:
                    try:
                        history = json.loads(source.parse_fix_history)
                    except:
                        history = []

                history.append(fix_history_entry)
                # 只保留最近20条记录
                history = history[-20:]

                source.parse_fix_history = json.dumps(history, ensure_ascii=False)
                source.last_error = None  # 清除错误信息

                session.commit()
                logger.info(f"✅ 源配置已更新: {source.name}")
                return True

        except Exception as e:
            logger.error(f"❌ 更新源配置失败: {e}")
            return False
