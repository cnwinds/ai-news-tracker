"""
统一配置管理模块
"""
import os
import json
import logging
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class Settings:
    """应用配置类"""

    def __init__(self):
        self._load_env()

    def _load_env(self):
        """加载环境变量"""
        # 首先设置项目根目录（从 backend/app/core/settings.py 计算）
        # __file__ = backend/app/core/settings.py
        # .parent = backend/app/core/
        # .parent = backend/app/
        # .parent = backend/
        # .parent = 项目根目录
        self.PROJECT_ROOT: Path = Path(__file__).parent.parent.parent.parent
        self.DATA_DIR: Path = self.PROJECT_ROOT / "backend" / "app" / "data"
        self.CONFIG_DIR: Path = self.PROJECT_ROOT / "backend" / "app"

        # 确保必要目录存在
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        
        # OpenAI API配置（从数据库加载，这里只设置默认值）
        self.OPENAI_API_KEY: str = ""
        self.OPENAI_API_BASE: str = "https://api.openai.com/v1"
        self.OPENAI_MODEL: str = "gpt-4-turbo-preview"
        self.OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

        # 通知配置（从数据库加载，这里只设置默认值）
        self.NOTIFICATION_PLATFORM: str = "feishu"  # feishu 或 dingtalk
        self.NOTIFICATION_WEBHOOK_URL: str = os.getenv("FEISHU_BOT_WEBHOOK", "")  # 兼容旧配置
        self.NOTIFICATION_SECRET: str = ""  # 钉钉加签密钥（可选）
        self.INSTANT_NOTIFICATION_ENABLED: bool = True  # 是否启用即时通知
        
        # 兼容旧配置（飞书机器人配置）
        self.FEISHU_BOT_WEBHOOK: str = os.getenv("FEISHU_BOT_WEBHOOK", "")

        # 数据库配置（默认使用 backend/app/data/ai_news.db）
        default_db_path = str(self.DATA_DIR / "ai_news.db")
        self.DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{default_db_path}")

        # 定时任务配置（从数据库加载，这里只设置默认值）
        self.COLLECTION_CRON: str = "0 */1 * * *"
        # 注意：DAILY_SUMMARY_CRON 已移除，现在使用数据库中的 daily_summary_time 配置

        # 采集配置（从数据库加载，这里只设置默认值）
        self.MAX_WORKERS: int = 3
        self.REQUEST_TIMEOUT: int = 30
        self.MAX_RETRIES: int = 3
        self.MAX_ARTICLES_PER_SOURCE: int = 50
        self.COLLECTION_INTERVAL_HOURS: int = 1

        # Web配置
        self.WEB_HOST: str = os.getenv("WEB_HOST", "0.0.0.0")
        self.WEB_PORT: int = int(os.getenv("WEB_PORT", "8501"))

        # 日志配置
        self.LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
        self.LOG_FILE: Optional[str] = os.getenv("LOG_FILE")
        
        # 文章过滤配置（从数据库读取，支持运行时修改）
        # 延迟加载，因为此时数据库可能还未初始化
        self._collection_settings_loaded = False
        self._summary_settings_loaded = False
        self._llm_settings_loaded = False
        self._collector_settings_loaded = False
        self._notification_settings_loaded = False
        
        # 设置默认值（如果数据库中没有配置，将使用这些值）
        self.MAX_ARTICLE_AGE_DAYS: int = int(os.getenv("MAX_ARTICLE_AGE_DAYS", "30"))
        self.MAX_ANALYSIS_AGE_DAYS: int = int(os.getenv("MAX_ANALYSIS_AGE_DAYS", "7"))
        self.AUTO_COLLECTION_ENABLED: bool = False
        self.DAILY_SUMMARY_ENABLED: bool = True
        self.DAILY_SUMMARY_TIME: str = "09:00"
        self.WEEKLY_SUMMARY_ENABLED: bool = True
        self.WEEKLY_SUMMARY_TIME: str = "09:00"

    def is_ai_enabled(self) -> bool:
        """检查AI分析是否启用"""
        return bool(self.OPENAI_API_KEY)

    def is_feishu_enabled(self) -> bool:
        """检查飞书通知是否启用"""
        return bool(self.FEISHU_BOT_WEBHOOK)
    
    def is_notification_enabled(self) -> bool:
        """检查通知是否启用"""
        return bool(self.NOTIFICATION_WEBHOOK_URL)
    
    def load_settings_from_db(self):
        """从数据库加载所有配置（在数据库初始化后调用）"""
        self._load_collection_settings()
        self._load_summary_settings()
        self._load_llm_settings()
        self._load_collector_settings()
        self._load_notification_settings()
    
    def _load_collection_settings(self):
        """加载采集配置（从数据库读取，支持运行时修改）"""
        if self._collection_settings_loaded:
            return
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            # 确保数据库已初始化
            if not hasattr(db, 'engine'):
                return
            
            with db.get_session() as session:
                self.MAX_ARTICLE_AGE_DAYS = AppSettingsRepository.get_setting(
                    session, "max_article_age_days", self.MAX_ARTICLE_AGE_DAYS
                )
                self.MAX_ANALYSIS_AGE_DAYS = AppSettingsRepository.get_setting(
                    session, "max_analysis_age_days", self.MAX_ANALYSIS_AGE_DAYS
                )
                self.AUTO_COLLECTION_ENABLED = AppSettingsRepository.get_setting(
                    session, "auto_collection_enabled", self.AUTO_COLLECTION_ENABLED
                )
            
            self._collection_settings_loaded = True
        except Exception as e:
            # 如果数据库未初始化或读取失败，使用默认值
            # 尝试从JSON文件迁移（仅一次，延迟执行）
            try:
                self._migrate_from_json_if_needed()
            except:
                pass
    
    def save_collection_settings(self, max_article_age_days: int, max_analysis_age_days: int):
        """保存采集配置到数据库"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                AppSettingsRepository.set_setting(
                    session, "max_article_age_days", max_article_age_days, "int",
                    "文章采集最大天数"
                )
                AppSettingsRepository.set_setting(
                    session, "max_analysis_age_days", max_analysis_age_days, "int",
                    "AI分析最大天数"
                )
            
            # 更新内存中的值
            self.MAX_ARTICLE_AGE_DAYS = max_article_age_days
            self.MAX_ANALYSIS_AGE_DAYS = max_analysis_age_days
            return True
        except Exception as e:
            print(f"保存采集配置失败: {e}")
            return False
    
    def save_auto_collection_settings(
        self, 
        enabled: bool, 
        interval_hours: int = None,
        max_articles_per_source: int = None,
        request_timeout: int = None
    ):
        """保存自动采集配置到数据库"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                AppSettingsRepository.set_setting(
                    session, "auto_collection_enabled", enabled, "bool",
                    "是否启用自动采集"
                )
                # 如果提供了 interval_hours，更新它；否则使用当前的 COLLECTION_INTERVAL_HOURS
                if interval_hours is not None:
                    AppSettingsRepository.set_setting(
                        session, "collection_interval_hours", interval_hours, "int",
                        "采集间隔（小时）"
                    )
                    self.COLLECTION_INTERVAL_HOURS = interval_hours
                
                # 如果提供了 max_articles_per_source，更新它
                if max_articles_per_source is not None:
                    AppSettingsRepository.set_setting(
                        session, "max_articles_per_source", max_articles_per_source, "int",
                        "每次采集每源最多获取文章数"
                    )
                    self.MAX_ARTICLES_PER_SOURCE = max_articles_per_source
                
                # 如果提供了 request_timeout，更新它
                if request_timeout is not None:
                    AppSettingsRepository.set_setting(
                        session, "request_timeout", request_timeout, "int",
                        "请求超时（秒）"
                    )
                    self.REQUEST_TIMEOUT = request_timeout
            
            # 更新内存中的值
            self.AUTO_COLLECTION_ENABLED = enabled
            return True
        except Exception as e:
            print(f"保存自动采集配置失败: {e}")
            return False
    
    def _load_summary_settings(self):
        """加载总结配置（从数据库读取，支持运行时修改）"""
        if self._summary_settings_loaded:
            return
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            # 确保数据库已初始化
            if not hasattr(db, 'engine'):
                return
            
            with db.get_session() as session:
                self.DAILY_SUMMARY_ENABLED = AppSettingsRepository.get_setting(
                    session, "daily_summary_enabled", self.DAILY_SUMMARY_ENABLED
                )
                self.DAILY_SUMMARY_TIME = AppSettingsRepository.get_setting(
                    session, "daily_summary_time", self.DAILY_SUMMARY_TIME
                )
                self.WEEKLY_SUMMARY_ENABLED = AppSettingsRepository.get_setting(
                    session, "weekly_summary_enabled", self.WEEKLY_SUMMARY_ENABLED
                )
                self.WEEKLY_SUMMARY_TIME = AppSettingsRepository.get_setting(
                    session, "weekly_summary_time", self.WEEKLY_SUMMARY_TIME
                )
            
            self._summary_settings_loaded = True
        except Exception as e:
            # 如果数据库未初始化或读取失败，使用默认值
            pass
    
    def save_summary_settings(self, daily_enabled: bool, daily_time: str, weekly_enabled: bool, weekly_time: str):
        """保存总结配置到数据库"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                AppSettingsRepository.set_setting(
                    session, "daily_summary_enabled", daily_enabled, "bool",
                    "是否启用每日总结"
                )
                AppSettingsRepository.set_setting(
                    session, "daily_summary_time", daily_time, "string",
                    "每日总结时间（格式：HH:MM）"
                )
                AppSettingsRepository.set_setting(
                    session, "weekly_summary_enabled", weekly_enabled, "bool",
                    "是否启用每周总结"
                )
                AppSettingsRepository.set_setting(
                    session, "weekly_summary_time", weekly_time, "string",
                    "每周总结时间（格式：HH:MM，在周六执行）"
                )
            
            # 更新内存中的值
            self.DAILY_SUMMARY_ENABLED = daily_enabled
            self.DAILY_SUMMARY_TIME = daily_time
            self.WEEKLY_SUMMARY_ENABLED = weekly_enabled
            self.WEEKLY_SUMMARY_TIME = weekly_time
            return True
        except Exception as e:
            print(f"保存总结配置失败: {e}")
            return False

    def _migrate_from_json_if_needed(self):
        """从JSON文件迁移配置到数据库（仅执行一次）"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            collection_settings_path = self.CONFIG_DIR / "collection_settings.json"
            if not collection_settings_path.exists():
                return
            
            # 确保数据库已初始化
            db = get_db()
            if not hasattr(db, 'engine'):
                return
            
            # 检查是否已经迁移过
            with db.get_session() as session:
                try:
                    migrated = AppSettingsRepository.get_setting(session, "_migrated_from_json", False)
                    if migrated:
                        return
                except:
                    # 如果表不存在，稍后再试
                    return
                
                # 读取JSON文件
                with open(collection_settings_path, "r", encoding="utf-8") as f:
                    settings_data = json.load(f)
                
                # 迁移配置到数据库
                AppSettingsRepository.set_setting(
                    session, "max_article_age_days", 
                    settings_data.get("max_article_age_days", 30), "int",
                    "文章采集最大天数"
                )
                AppSettingsRepository.set_setting(
                    session, "max_analysis_age_days",
                    settings_data.get("max_analysis_age_days", 7), "int",
                    "AI分析最大天数"
                )
                AppSettingsRepository.set_setting(
                    session, "auto_collection_enabled",
                    settings_data.get("auto_collection_enabled", False), "bool",
                    "是否启用自动采集"
                )
                AppSettingsRepository.set_setting(
                    session, "daily_summary_enabled",
                    settings_data.get("daily_summary_enabled", True), "bool",
                    "是否启用每日总结"
                )
                AppSettingsRepository.set_setting(
                    session, "daily_summary_time",
                    settings_data.get("daily_summary_time", "09:00"), "string",
                    "每日总结时间（格式：HH:MM）"
                )
                AppSettingsRepository.set_setting(
                    session, "weekly_summary_enabled",
                    settings_data.get("weekly_summary_enabled", True), "bool",
                    "是否启用每周总结"
                )
                AppSettingsRepository.set_setting(
                    session, "weekly_summary_time",
                    settings_data.get("weekly_summary_time", "09:00"), "string",
                    "每周总结时间（格式：HH:MM，在周六执行）"
                )
                
                # 标记已迁移
                AppSettingsRepository.set_setting(
                    session, "_migrated_from_json", True, "bool"
                )
                
                # 更新内存中的值
                self.MAX_ARTICLE_AGE_DAYS = settings_data.get("max_article_age_days", 30)
                self.MAX_ANALYSIS_AGE_DAYS = settings_data.get("max_analysis_age_days", 7)
                self.AUTO_COLLECTION_ENABLED = settings_data.get("auto_collection_enabled", False)
                self.DAILY_SUMMARY_ENABLED = settings_data.get("daily_summary_enabled", True)
                self.DAILY_SUMMARY_TIME = settings_data.get("daily_summary_time", "09:00")
                self.WEEKLY_SUMMARY_ENABLED = settings_data.get("weekly_summary_enabled", True)
                self.WEEKLY_SUMMARY_TIME = settings_data.get("weekly_summary_time", "09:00")
                
                logger.info("✅ 配置已从JSON文件迁移到数据库")
                
        except Exception as e:
            # 迁移失败不影响系统运行
            logger.warning(f"从JSON迁移配置失败: {e}")
    
    def get_auto_collection_interval_hours(self) -> int:
        """获取自动采集间隔时间（小时）"""
        if not self.AUTO_COLLECTION_ENABLED:
            return None
        return self.COLLECTION_INTERVAL_HOURS
    
    def get_daily_summary_cron(self) -> str:
        """根据每日总结时间生成cron表达式"""
        if not self.DAILY_SUMMARY_ENABLED:
            return None
        
        try:
            hour, minute = self.DAILY_SUMMARY_TIME.split(":")
            hour = int(hour)
            minute = int(minute)
            # cron格式: 分 时 日 月 周（每天执行）
            return f"{minute} {hour} * * *"
        except (ValueError, AttributeError):
            return None
    
    def get_weekly_summary_cron(self) -> str:
        """根据每周总结时间生成cron表达式（周六执行）"""
        if not self.WEEKLY_SUMMARY_ENABLED:
            return None
        
        try:
            hour, minute = self.WEEKLY_SUMMARY_TIME.split(":")
            hour = int(hour)
            minute = int(minute)
            # cron格式: 分 时 日 月 周（周六执行，6表示周六）
            return f"{minute} {hour} * * 6"
        except (ValueError, AttributeError):
            return None
    
    def _load_llm_settings(self):
        """加载LLM配置（从数据库读取，支持运行时修改）"""
        if self._llm_settings_loaded:
            return
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            from backend.app.db.models import AppSettings
            
            db = get_db()
            # 确保数据库已初始化
            if not hasattr(db, 'engine'):
                return
            
            with db.get_session() as session:
                # 获取配置值，对于字符串类型，如果数据库中的值不为None，就使用数据库中的值（即使是空字符串）
                setting = session.query(AppSettings).filter(AppSettings.key == "openai_api_key").first()
                if setting is not None:
                    # 如果数据库中有这个配置项，使用数据库中的值（即使是空字符串）
                    self.OPENAI_API_KEY = setting.value if setting.value is not None else self.OPENAI_API_KEY
                else:
                    # 如果数据库中没有这个配置项，保持默认值
                    pass
                
                self.OPENAI_API_BASE = AppSettingsRepository.get_setting(
                    session, "openai_api_base", self.OPENAI_API_BASE
                )
                self.OPENAI_MODEL = AppSettingsRepository.get_setting(
                    session, "openai_model", self.OPENAI_MODEL
                )
                self.OPENAI_EMBEDDING_MODEL = AppSettingsRepository.get_setting(
                    session, "openai_embedding_model", self.OPENAI_EMBEDDING_MODEL
                )
            
            # 记录加载结果（用于调试）
            logger.debug(f"LLM配置加载完成: API_KEY={'已配置' if self.OPENAI_API_KEY else '未配置'}, "
                        f"BASE={self.OPENAI_API_BASE}, MODEL={self.OPENAI_MODEL}")
            
            self._llm_settings_loaded = True
        except Exception as e:
            # 如果数据库未初始化或读取失败，使用默认值（环境变量）
            logger.debug(f"从数据库加载LLM配置失败，使用环境变量: {e}")
    
    def save_llm_settings(self, api_key: str, api_base: str, model: str, embedding_model: str):
        """保存LLM配置到数据库"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                AppSettingsRepository.set_setting(
                    session, "openai_api_key", api_key, "string",
                    "OpenAI API密钥"
                )
                AppSettingsRepository.set_setting(
                    session, "openai_api_base", api_base, "string",
                    "OpenAI API基础URL"
                )
                AppSettingsRepository.set_setting(
                    session, "openai_model", model, "string",
                    "OpenAI模型名称"
                )
                AppSettingsRepository.set_setting(
                    session, "openai_embedding_model", embedding_model, "string",
                    "OpenAI嵌入模型名称"
                )
            
            # 更新内存中的值
            self.OPENAI_API_KEY = api_key
            self.OPENAI_API_BASE = api_base
            self.OPENAI_MODEL = model
            self.OPENAI_EMBEDDING_MODEL = embedding_model
            return True
        except Exception as e:
            logger.error(f"保存LLM配置失败: {e}")
            return False
    
    def _load_collector_settings(self):
        """加载采集器配置（从数据库读取，支持运行时修改）"""
        if self._collector_settings_loaded:
            return
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            # 确保数据库已初始化
            if not hasattr(db, 'engine'):
                return
            
            with db.get_session() as session:
                self.COLLECTION_CRON = AppSettingsRepository.get_setting(
                    session, "collection_cron", self.COLLECTION_CRON
                )
                self.COLLECTION_INTERVAL_HOURS = AppSettingsRepository.get_setting(
                    session, "collection_interval_hours", self.COLLECTION_INTERVAL_HOURS
                )
                self.MAX_ARTICLES_PER_SOURCE = AppSettingsRepository.get_setting(
                    session, "max_articles_per_source", self.MAX_ARTICLES_PER_SOURCE
                )
                self.REQUEST_TIMEOUT = AppSettingsRepository.get_setting(
                    session, "request_timeout", self.REQUEST_TIMEOUT
                )
            
            self._collector_settings_loaded = True
        except Exception as e:
            # 如果数据库未初始化或读取失败，使用默认值（环境变量）
            logger.debug(f"从数据库加载采集器配置失败，使用环境变量: {e}")
    
    def save_collector_settings(self, collection_interval_hours: int, max_articles_per_source: int, request_timeout: int):
        """保存采集器配置到数据库"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                AppSettingsRepository.set_setting(
                    session, "collection_interval_hours", collection_interval_hours, "int",
                    "采集间隔（小时）"
                )
                AppSettingsRepository.set_setting(
                    session, "max_articles_per_source", max_articles_per_source, "int",
                    "每次采集每源最多获取文章数"
                )
                AppSettingsRepository.set_setting(
                    session, "request_timeout", request_timeout, "int",
                    "请求超时（秒）"
                )
            
            # 更新内存中的值
            self.COLLECTION_INTERVAL_HOURS = collection_interval_hours
            self.MAX_ARTICLES_PER_SOURCE = max_articles_per_source
            self.REQUEST_TIMEOUT = request_timeout
            return True
        except Exception as e:
            logger.error(f"保存采集器配置失败: {e}")
            return False
    
    def _load_notification_settings(self):
        """加载通知配置（从数据库读取，支持运行时修改）"""
        if self._notification_settings_loaded:
            return
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            # 确保数据库已初始化
            if not hasattr(db, 'engine'):
                return
            
            with db.get_session() as session:
                self.NOTIFICATION_PLATFORM = AppSettingsRepository.get_setting(
                    session, "notification_platform", self.NOTIFICATION_PLATFORM
                )
                self.NOTIFICATION_WEBHOOK_URL = AppSettingsRepository.get_setting(
                    session, "notification_webhook_url", self.NOTIFICATION_WEBHOOK_URL
                )
                self.NOTIFICATION_SECRET = AppSettingsRepository.get_setting(
                    session, "notification_secret", self.NOTIFICATION_SECRET
                )
                self.INSTANT_NOTIFICATION_ENABLED = AppSettingsRepository.get_setting(
                    session, "instant_notification_enabled", self.INSTANT_NOTIFICATION_ENABLED
                )
            
            # 兼容旧配置：如果数据库中没有配置，但环境变量中有 FEISHU_BOT_WEBHOOK，使用它
            if not self.NOTIFICATION_WEBHOOK_URL and self.FEISHU_BOT_WEBHOOK:
                self.NOTIFICATION_WEBHOOK_URL = self.FEISHU_BOT_WEBHOOK
                self.NOTIFICATION_PLATFORM = "feishu"
            
            self._notification_settings_loaded = True
        except Exception as e:
            # 如果数据库未初始化或读取失败，使用默认值
            logger.debug(f"从数据库加载通知配置失败，使用默认值: {e}")
    
    def save_notification_settings(
        self,
        platform: str,
        webhook_url: str,
        secret: str = "",
        instant_notification_enabled: bool = True
    ):
        """保存通知配置到数据库"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                AppSettingsRepository.set_setting(
                    session, "notification_platform", platform, "string",
                    "通知平台（feishu/dingtalk）"
                )
                AppSettingsRepository.set_setting(
                    session, "notification_webhook_url", webhook_url, "string",
                    "通知Webhook URL"
                )
                AppSettingsRepository.set_setting(
                    session, "notification_secret", secret, "string",
                    "钉钉加签密钥（可选）"
                )
                AppSettingsRepository.set_setting(
                    session, "instant_notification_enabled", instant_notification_enabled, "bool",
                    "是否启用即时通知"
                )
            
            # 更新内存中的值
            self.NOTIFICATION_PLATFORM = platform
            self.NOTIFICATION_WEBHOOK_URL = webhook_url
            self.NOTIFICATION_SECRET = secret
            self.INSTANT_NOTIFICATION_ENABLED = instant_notification_enabled
            return True
        except Exception as e:
            logger.error(f"保存通知配置失败: {e}")
            return False


# 全局配置实例
settings = Settings()

