"""
采集器基类 - 定义统一的采集器接口
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime


class BaseCollector(ABC):
    """采集器抽象基类"""
    
    @abstractmethod
    def fetch_articles(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
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
    def validate_config(self, config: Dict[str, Any]) -> tuple[bool, Optional[str]]:
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
        raw_data: Any, 
        config: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
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
