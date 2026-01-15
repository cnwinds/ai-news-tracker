"""
采集器基类 - 定义统一的采集器接口
"""
from abc import ABC, abstractmethod
from typing import List, Optional, Union
from datetime import datetime
from bs4 import BeautifulSoup
import re
import logging

from backend.app.services.collector.types import ArticleDict, CollectorConfig

logger = logging.getLogger(__name__)


class BaseCollector(ABC):
    """采集器抽象基类"""
    
    @abstractmethod
    def fetch_articles(self, config: CollectorConfig) -> List[ArticleDict]:
        """
        从数据源获取文章列表
        
        Args:
            config: 采集配置字典，包含：
                - name: 源名称
                - url: 源URL（对于某些类型可能为空）
                - extra_config: 扩展配置（JSON格式或字典）
                - max_articles: 最大文章数（可选）
                以及其他特定于采集器类型的配置
        
        Returns:
            文章列表，每个文章包含：
                - title: 标题（必需）
                - url: 文章URL（必需）
                - content: 内容（可选）
                - source: 来源名称（可选，通常由采集服务设置）
                - author: 作者（可选）
                - published_at: 发布时间（可选）
                - category: 分类（可选）
                - metadata: 额外元数据（可选）
        """
        pass
    
    @abstractmethod
    def validate_config(self, config: CollectorConfig) -> tuple[bool, Optional[str]]:
        """
        验证配置是否有效
        
        Args:
            config: 采集配置字典
        
        Returns:
            (is_valid, error_message) 元组
            - is_valid: 配置是否有效
            - error_message: 如果无效，返回错误信息；如果有效，返回None
        """
        pass
    
    def get_collector_type(self) -> str:
        """
        返回采集器类型标识
        
        Returns:
            采集器类型字符串，如 "rss", "api", "web", "email" 等
        """
        return self.__class__.__name__.lower().replace("collector", "")
    
    def extract_articles_from_data(
        self, 
        raw_data: Union[str, dict, list], 
        config: CollectorConfig
    ) -> List[ArticleDict]:
        """
        从原始数据中提取文章（可选实现）
        
        某些采集器可能需要先获取原始数据，然后解析提取文章。
        这个方法提供了统一的接口，但并不是所有采集器都需要实现。
        
        Args:
            raw_data: 原始数据（HTML、JSON、XML等）
            config: 采集配置
        
        Returns:
            文章列表
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not implement extract_articles_from_data"
        )
    
    @staticmethod
    def html_to_markdown(html_content: str) -> str:
        """
        将HTML内容转换为Markdown格式，保留链接、标题、列表等格式
        
        Args:
            html_content: HTML字符串
            
        Returns:
            Markdown格式的字符串
        """
        if not html_content:
            return ""
        
        try:
            soup = BeautifulSoup(html_content, "html.parser")
            
            # 处理所有链接，转换为Markdown格式
            for link in soup.find_all('a'):
                href = link.get('href', '')
                link_text = link.get_text(strip=True)
                
                if href:
                    # 如果是相对链接，保留原样（前端可以处理）
                    if href.startswith('http://') or href.startswith('https://') or href.startswith('mailto:'):
                        full_url = href
                    else:
                        full_url = href
                    
                    # 将链接转换为Markdown格式：[文本](URL)
                    if link_text:
                        markdown_link = f"[{link_text}]({full_url})"
                    else:
                        # 如果链接没有文本，直接显示URL
                        markdown_link = full_url
                    
                    # 替换原链接为Markdown格式
                    link.replace_with(markdown_link)
            
            # 处理标题（h1-h6）
            for i in range(1, 7):
                for heading in soup.find_all(f'h{i}'):
                    text = heading.get_text(strip=True)
                    if text:
                        heading.replace_with(f"\n{'#' * i} {text}\n")
            
            # 处理粗体和斜体
            for bold in soup.find_all(['b', 'strong']):
                text = bold.get_text(strip=True)
                if text:
                    bold.replace_with(f"**{text}**")
            
            for italic in soup.find_all(['i', 'em']):
                text = italic.get_text(strip=True)
                if text:
                    italic.replace_with(f"*{text}*")
            
            # 处理代码块
            for code in soup.find_all('code'):
                text = code.get_text()
                if text:
                    # 检查是否是代码块（有pre父元素）
                    if code.parent and code.parent.name == 'pre':
                        code.replace_with(text)
                    else:
                        code.replace_with(f"`{text}`")
            
            # 处理代码块（pre标签）
            for pre in soup.find_all('pre'):
                text = pre.get_text()
                if text:
                    pre.replace_with(f"\n```\n{text}\n```\n")
            
            # 处理列表
            for ul in soup.find_all('ul'):
                items = []
                for li in ul.find_all('li', recursive=False):
                    text = li.get_text(strip=True)
                    if text:
                        items.append(f"- {text}")
                if items:
                    ul.replace_with("\n" + "\n".join(items) + "\n")
            
            for ol in soup.find_all('ol'):
                items = []
                for idx, li in enumerate(ol.find_all('li', recursive=False), 1):
                    text = li.get_text(strip=True)
                    if text:
                        items.append(f"{idx}. {text}")
                if items:
                    ol.replace_with("\n" + "\n".join(items) + "\n")
            
            # 处理段落
            for p in soup.find_all('p'):
                text = p.get_text(strip=True)
                if text:
                    p.replace_with(f"\n{text}\n")
            
            # 处理换行（br标签）
            for br in soup.find_all('br'):
                br.replace_with("\n")
            
            # 处理水平线
            for hr in soup.find_all('hr'):
                hr.replace_with("\n---\n")
            
            # 处理引用
            for blockquote in soup.find_all('blockquote'):
                text = blockquote.get_text(strip=True)
                if text:
                    # 为每行添加引用标记
                    lines = text.split('\n')
                    quoted_lines = [f"> {line}" if line.strip() else ">" for line in lines]
                    blockquote.replace_with("\n" + "\n".join(quoted_lines) + "\n")
            
            # 提取文本，保留换行
            text = soup.get_text(separator="\n", strip=False)
            
            # 清理多余的空行（保留单个换行）
            lines = []
            prev_empty = False
            for line in text.split('\n'):
                line = line.strip()
                if line:
                    lines.append(line)
                    prev_empty = False
                elif not prev_empty:
                    # 保留单个空行
                    lines.append('')
                    prev_empty = True
            
            result = '\n'.join(lines)
            
            # 清理多余空白，但保留Markdown格式
            # 移除超过2个连续换行
            result = re.sub(r'\n{3,}', '\n\n', result)
            
            return result.strip()
            
        except Exception as e:
            logger.warning(f"⚠️  HTML转Markdown失败，回退到纯文本: {e}")
            # 如果处理失败，回退到简单的文本提取
            try:
                soup = BeautifulSoup(html_content, "html.parser")
                return soup.get_text(separator=" ", strip=True)
            except Exception:
                return html_content
