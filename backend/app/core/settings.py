"""
统一配置管理模块
"""
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class Settings:
    """应用配置类"""

    def __init__(self):
        self._load_env()

    def _load_env(self):
        """加载环境变量"""
        # 使用统一的路径管理模块
        from backend.app.core.paths import PROJECT_ROOT, APP_ROOT
        
        self.PROJECT_ROOT: Path = PROJECT_ROOT
        self.DATA_DIR: Path = APP_ROOT / "data"
        self.CONFIG_DIR: Path = APP_ROOT

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
        self.QUIET_HOURS: List[Dict[str, str]] = []  # 勿扰时段列表，格式：[{"start_time": "22:00", "end_time": "08:00"}]
        
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
        self._image_settings_loaded = False
        self._collector_settings_loaded = False
        self._notification_settings_loaded = False
        self._social_media_settings_loaded = False
        
        # 设置默认值（如果数据库中没有配置，将使用这些值）
        self.MAX_ARTICLE_AGE_DAYS: int = int(os.getenv("MAX_ARTICLE_AGE_DAYS", "30"))
        self.MAX_ANALYSIS_AGE_DAYS: int = int(os.getenv("MAX_ANALYSIS_AGE_DAYS", "7"))
        self.AUTO_COLLECTION_ENABLED: bool = False
        self.DAILY_SUMMARY_ENABLED: bool = True
        self.DAILY_SUMMARY_TIME: str = "09:00"
        self.WEEKLY_SUMMARY_ENABLED: bool = True
        self.WEEKLY_SUMMARY_TIME: str = "09:00"
        
        # 提供商选择配置（从数据库加载）
        self.SELECTED_LLM_PROVIDER_ID: Optional[int] = None
        self.SELECTED_EMBEDDING_PROVIDER_ID: Optional[int] = None
        self.SELECTED_LLM_MODELS: List[str] = []  # 选定的模型列表
        self.SELECTED_EMBEDDING_MODELS: List[str] = []  # 选定的向量模型列表
        
        # 图片生成提供商选择配置（从数据库加载）
        self.SELECTED_IMAGE_PROVIDER_ID: Optional[int] = None
        self.SELECTED_IMAGE_MODELS: List[str] = []  # 选定的图片生成模型列表
        
        # 社交平台API密钥配置（从数据库加载）
        self.YOUTUBE_API_KEY: Optional[str] = None
        self.TIKTOK_API_KEY: Optional[str] = None
        self.TWITTER_API_KEY: Optional[str] = None
        self.REDDIT_CLIENT_ID: Optional[str] = None
        self.REDDIT_CLIENT_SECRET: Optional[str] = None
        self.REDDIT_USER_AGENT: Optional[str] = None
        
        # 社交平台定时任务配置（从数据库加载）
        self.SOCIAL_MEDIA_AUTO_REPORT_ENABLED: bool = False
        self.SOCIAL_MEDIA_AUTO_REPORT_TIME: str = "09:00"

    def is_ai_enabled(self) -> bool:
        """检查AI分析是否启用"""
        return bool(self.OPENAI_API_KEY)

    def is_feishu_enabled(self) -> bool:
        """检查飞书通知是否启用"""
        return bool(self.FEISHU_BOT_WEBHOOK)
    
    def is_notification_enabled(self) -> bool:
        """检查通知是否启用"""
        return bool(self.NOTIFICATION_WEBHOOK_URL)
    
    def load_settings_from_db(self, force_reload: bool = False):
        """从数据库加载所有配置（在数据库初始化后调用）
        
        Args:
            force_reload: 如果为True，强制重新加载所有配置（忽略缓存）
        """
        if force_reload:
            # 重置所有加载标志，强制重新加载
            self._collection_settings_loaded = False
            self._summary_settings_loaded = False
            self._llm_settings_loaded = False
            self._image_settings_loaded = False
            self._collector_settings_loaded = False
            self._notification_settings_loaded = False
            self._social_media_settings_loaded = False
        
        self._load_collection_settings()
        self._load_summary_settings()
        self._load_llm_settings()
        self._load_image_settings()
        self._load_collector_settings()
        self._load_notification_settings()
        self._load_social_media_settings()
    
    def _get_db_session(self):
        """获取数据库会话（如果数据库已初始化）
        
        Returns:
            数据库会话上下文管理器，如果数据库未初始化则返回 None
        """
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            if not hasattr(db, 'engine'):
                return None
            
            return db.get_session()
        except Exception:
            return None
    
    def _load_setting(self, session, key: str, default_value: Any, setting_type: str = "string") -> Any:
        """从数据库加载单个配置项
        
        Args:
            session: 数据库会话
            key: 配置键
            default_value: 默认值
            setting_type: 配置类型（用于类型转换）
            
        Returns:
            配置值
        """
        from backend.app.db.repositories import AppSettingsRepository
        
        # AppSettingsRepository.get_setting 已经根据 value_type 进行了正确的类型转换
        # 所以这里不需要再次转换，直接返回即可
        value = AppSettingsRepository.get_setting(session, key, default_value)
        
        # 对于 int 类型，确保返回的是整数（如果 value_type 不是 int，可能需要转换）
        if setting_type == "int" and value is not None:
            try:
                return int(value) if not isinstance(value, int) else value
            except (ValueError, TypeError):
                return default_value
        
        # 对于 bool 类型，AppSettingsRepository 已经正确转换了，直接返回
        # 注意：不要使用 bool(value)，因为 bool("False") 会返回 True
        return value
    
    def _load_collection_settings(self):
        """加载采集配置（从数据库读取，支持运行时修改）"""
        if self._collection_settings_loaded:
            return
        
        session = self._get_db_session()
        if session is None:
            try:
                self._migrate_from_json_if_needed()
            except Exception:
                pass
            return
        
        try:
            with session as s:
                self.MAX_ARTICLE_AGE_DAYS = self._load_setting(
                    s, "max_article_age_days", self.MAX_ARTICLE_AGE_DAYS, "int"
                )
                self.MAX_ANALYSIS_AGE_DAYS = self._load_setting(
                    s, "max_analysis_age_days", self.MAX_ANALYSIS_AGE_DAYS, "int"
                )
                self.AUTO_COLLECTION_ENABLED = self._load_setting(
                    s, "auto_collection_enabled", self.AUTO_COLLECTION_ENABLED, "bool"
                )
            
            self._collection_settings_loaded = True
        except Exception as e:
            logger.debug(f"加载采集配置失败: {e}")
            try:
                self._migrate_from_json_if_needed()
            except Exception:
                pass
    
    def _save_setting(
        self, session, key: str, value: Any, setting_type: str, description: str
    ) -> None:
        """保存单个配置项到数据库
        
        Args:
            session: 数据库会话
            key: 配置键
            value: 配置值
            setting_type: 配置类型
            description: 配置描述
        """
        from backend.app.db.repositories import AppSettingsRepository
        
        AppSettingsRepository.set_setting(session, key, value, setting_type, description)
    
    def save_collection_settings(self, max_article_age_days: int, max_analysis_age_days: int) -> bool:
        """保存采集配置到数据库
        
        Args:
            max_article_age_days: 文章采集最大天数
            max_analysis_age_days: AI分析最大天数
            
        Returns:
            是否保存成功
        """
        try:
            from backend.app.db import get_db
            
            db = get_db()
            with db.get_session() as session:
                self._save_setting(
                    session, "max_article_age_days", max_article_age_days, "int",
                    "文章采集最大天数"
                )
                self._save_setting(
                    session, "max_analysis_age_days", max_analysis_age_days, "int",
                    "AI分析最大天数"
                )
            
            self.MAX_ARTICLE_AGE_DAYS = max_article_age_days
            self.MAX_ANALYSIS_AGE_DAYS = max_analysis_age_days
            return True
        except Exception as e:
            logger.error(f"保存采集配置失败: {e}")
            return False
    
    def save_auto_collection_settings(
        self,
        enabled: bool,
        interval_hours: Optional[int] = None,
        max_articles_per_source: Optional[int] = None,
        request_timeout: Optional[int] = None
    ) -> bool:
        """保存自动采集配置到数据库

        Args:
            enabled: 是否启用自动采集
            interval_hours: 采集间隔（小时）
            max_articles_per_source: 每次采集每源最多获取文章数
            request_timeout: 请求超时（秒）

        Returns:
            是否保存成功
        """
        try:
            from backend.app.db import get_db

            db = get_db()
            with db.get_session() as session:
                logger.info(f"🔧 准备保存 auto_collection_enabled={enabled} (类型: {type(enabled).__name__})")
                self._save_setting(
                    session, "auto_collection_enabled", enabled, "bool",
                    "是否启用自动采集"
                )
                # 验证保存的值
                from backend.app.db.repositories import AppSettingsRepository
                saved_value = AppSettingsRepository.get_setting(session, "auto_collection_enabled", None)
                logger.info(f"✅ 验证保存后的值: auto_collection_enabled={saved_value} (类型: {type(saved_value).__name__})")
                
                if interval_hours is not None:
                    self._save_setting(
                        session, "collection_interval_hours", interval_hours, "int",
                        "采集间隔（小时）"
                    )
                    self.COLLECTION_INTERVAL_HOURS = interval_hours
                
                if max_articles_per_source is not None:
                    self._save_setting(
                        session, "max_articles_per_source", max_articles_per_source, "int",
                        "每次采集每源最多获取文章数"
                    )
                    self.MAX_ARTICLES_PER_SOURCE = max_articles_per_source
                
                if request_timeout is not None:
                    self._save_setting(
                        session, "request_timeout", request_timeout, "int",
                        "请求超时（秒）"
                    )
                    self.REQUEST_TIMEOUT = request_timeout
                
                # 显式刷新确保数据被写入（提交由上下文管理器处理）
                session.flush()
            
            self.AUTO_COLLECTION_ENABLED = enabled
            logger.info(f"✅ 自动采集配置已保存: enabled={enabled}, interval_hours={interval_hours}, max_articles_per_source={max_articles_per_source}, request_timeout={request_timeout}")
            return True
        except Exception as e:
            logger.error(f"保存自动采集配置失败: {e}", exc_info=True)
            return False
    
    def _load_summary_settings(self):
        """加载总结配置（从数据库读取，支持运行时修改）"""
        if self._summary_settings_loaded:
            return
        
        session = self._get_db_session()
        if session is None:
            return
        
        try:
            with session as s:
                self.DAILY_SUMMARY_ENABLED = self._load_setting(
                    s, "daily_summary_enabled", self.DAILY_SUMMARY_ENABLED, "bool"
                )
                self.DAILY_SUMMARY_TIME = self._load_setting(
                    s, "daily_summary_time", self.DAILY_SUMMARY_TIME, "string"
                )
                self.WEEKLY_SUMMARY_ENABLED = self._load_setting(
                    s, "weekly_summary_enabled", self.WEEKLY_SUMMARY_ENABLED, "bool"
                )
                self.WEEKLY_SUMMARY_TIME = self._load_setting(
                    s, "weekly_summary_time", self.WEEKLY_SUMMARY_TIME, "string"
                )
            
            self._summary_settings_loaded = True
        except Exception as e:
            logger.debug(f"加载总结配置失败: {e}")
    
    def save_summary_settings(
        self, daily_enabled: bool, daily_time: str, weekly_enabled: bool, weekly_time: str
    ) -> bool:
        """保存总结配置到数据库
        
        Args:
            daily_enabled: 是否启用每日总结
            daily_time: 每日总结时间（格式：HH:MM）
            weekly_enabled: 是否启用每周总结
            weekly_time: 每周总结时间（格式：HH:MM，在周六执行）
            
        Returns:
            是否保存成功
        """
        try:
            from backend.app.db import get_db
            
            db = get_db()
            with db.get_session() as session:
                self._save_setting(
                    session, "daily_summary_enabled", daily_enabled, "bool",
                    "是否启用每日总结"
                )
                self._save_setting(
                    session, "daily_summary_time", daily_time, "string",
                    "每日总结时间（格式：HH:MM）"
                )
                self._save_setting(
                    session, "weekly_summary_enabled", weekly_enabled, "bool",
                    "是否启用每周总结"
                )
                self._save_setting(
                    session, "weekly_summary_time", weekly_time, "string",
                    "每周总结时间（格式：HH:MM，在周六执行）"
                )
            
            self.DAILY_SUMMARY_ENABLED = daily_enabled
            self.DAILY_SUMMARY_TIME = daily_time
            self.WEEKLY_SUMMARY_ENABLED = weekly_enabled
            self.WEEKLY_SUMMARY_TIME = weekly_time
            return True
        except Exception as e:
            logger.error(f"保存总结配置失败: {e}")
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
                except Exception:
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
    
    def get_auto_collection_interval_hours(self) -> Optional[int]:
        """获取自动采集间隔时间（小时）
        
        Returns:
            采集间隔（小时），如果未启用则返回 None
        """
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
            # cron格式: 分 时 日 月 周（APScheduler中：0=周一，5=周六，6=周日）
            # 使用5表示周六执行
            return f"{minute} {hour} * * 5"
        except (ValueError, AttributeError):
            return None
    
    def _load_llm_settings(self):
        """加载LLM配置（从数据库读取，支持运行时修改）"""
        if self._llm_settings_loaded:
            return
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository, LLMProviderRepository
            from backend.app.db.models import AppSettings
            
            db = get_db()
            # 确保数据库已初始化
            if not hasattr(db, 'engine'):
                return
            
            with db.get_session() as session:
                # 加载提供商选择配置
                selected_llm_provider_id = AppSettingsRepository.get_setting(
                    session, "selected_llm_provider_id", None
                )
                selected_embedding_provider_id = AppSettingsRepository.get_setting(
                    session, "selected_embedding_provider_id", None
                )
                selected_llm_models_str = AppSettingsRepository.get_setting(
                    session, "selected_llm_models", ""
                )
                selected_embedding_models_str = AppSettingsRepository.get_setting(
                    session, "selected_embedding_models", ""
                )
                
                # 解析选定的模型列表
                if selected_llm_models_str:
                    self.SELECTED_LLM_MODELS = [m.strip() for m in str(selected_llm_models_str).split(",") if m.strip()]
                else:
                    self.SELECTED_LLM_MODELS = []
                
                if selected_embedding_models_str:
                    self.SELECTED_EMBEDDING_MODELS = [m.strip() for m in str(selected_embedding_models_str).split(",") if m.strip()]
                else:
                    self.SELECTED_EMBEDDING_MODELS = []
                
                # 从选定的提供商加载配置
                if selected_llm_provider_id:
                    try:
                        provider = LLMProviderRepository.get_by_id(session, selected_llm_provider_id)
                        if provider and provider.enabled:
                            self.OPENAI_API_KEY = provider.api_key
                            self.OPENAI_API_BASE = provider.api_base
                            # 如果选定了模型，使用第一个选定的模型；否则使用提供商的第一个模型
                            if self.SELECTED_LLM_MODELS:
                                self.OPENAI_MODEL = self.SELECTED_LLM_MODELS[0]
                            else:
                                # 解析提供商的模型列表，使用第一个
                                models = [m.strip() for m in provider.llm_model.split(",") if m.strip()]
                                self.OPENAI_MODEL = models[0] if models else provider.llm_model
                            self.SELECTED_LLM_PROVIDER_ID = selected_llm_provider_id
                        else:
                            logger.warning(f"选定的LLM提供商 {selected_llm_provider_id} 不存在或未启用")
                    except Exception as e:
                        logger.warning(f"加载选定的LLM提供商失败: {e}")
                
                if selected_embedding_provider_id:
                    try:
                        provider = LLMProviderRepository.get_by_id(session, selected_embedding_provider_id)
                        if provider and provider.enabled and provider.embedding_model:
                            # 如果选定了模型，使用第一个选定的模型；否则使用提供商的第一个模型
                            if self.SELECTED_EMBEDDING_MODELS:
                                self.OPENAI_EMBEDDING_MODEL = self.SELECTED_EMBEDDING_MODELS[0]
                            else:
                                # 解析提供商的模型列表，使用第一个
                                models = [m.strip() for m in provider.embedding_model.split(",") if m.strip()]
                                self.OPENAI_EMBEDDING_MODEL = models[0] if models else provider.embedding_model
                            self.SELECTED_EMBEDDING_PROVIDER_ID = selected_embedding_provider_id
                        else:
                            logger.warning(f"选定的向量模型提供商 {selected_embedding_provider_id} 不存在、未启用或不支持向量模型")
                    except Exception as e:
                        logger.warning(f"加载选定的向量模型提供商失败: {e}")
            
            # 记录加载结果（用于调试）
            logger.debug(f"LLM配置加载完成: API_KEY={'已配置' if self.OPENAI_API_KEY else '未配置'}, "
                        f"BASE={self.OPENAI_API_BASE}, MODEL={self.OPENAI_MODEL}, "
                        f"EMBEDDING_MODEL={self.OPENAI_EMBEDDING_MODEL}, "
                        f"LLM_PROVIDER_ID={self.SELECTED_LLM_PROVIDER_ID}, "
                        f"EMBEDDING_PROVIDER_ID={self.SELECTED_EMBEDDING_PROVIDER_ID}")
            
            self._llm_settings_loaded = True
        except Exception as e:
            # 如果数据库未初始化或读取失败，使用默认值（环境变量）
            logger.debug(f"从数据库加载LLM配置失败，使用环境变量: {e}")
    
    def load_llm_settings(self):
        """公共方法：强制重新加载LLM配置（从数据库读取最新值）"""
        self._llm_settings_loaded = False
        self._load_llm_settings()
    
    def save_llm_settings(self, selected_llm_provider_id: Optional[int] = None,
                          selected_embedding_provider_id: Optional[int] = None,
                          selected_llm_models: Optional[List[str]] = None,
                          selected_embedding_models: Optional[List[str]] = None):
        """保存LLM配置到数据库（只保存提供商选择）"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                # 保存提供商选择
                if selected_llm_provider_id is not None:
                    AppSettingsRepository.set_setting(
                        session, "selected_llm_provider_id", selected_llm_provider_id, "int",
                        "选定的LLM提供商ID"
                    )
                    self.SELECTED_LLM_PROVIDER_ID = selected_llm_provider_id
                
                if selected_embedding_provider_id is not None:
                    AppSettingsRepository.set_setting(
                        session, "selected_embedding_provider_id", selected_embedding_provider_id, "int",
                        "选定的向量模型提供商ID"
                    )
                    self.SELECTED_EMBEDDING_PROVIDER_ID = selected_embedding_provider_id
                
                # 保存选定的模型列表
                if selected_llm_models is not None:
                    models_str = ",".join(selected_llm_models)
                    AppSettingsRepository.set_setting(
                        session, "selected_llm_models", models_str, "string",
                        "选定的LLM模型列表（逗号分隔）"
                    )
                    self.SELECTED_LLM_MODELS = selected_llm_models
                
                if selected_embedding_models is not None:
                    models_str = ",".join(selected_embedding_models)
                    AppSettingsRepository.set_setting(
                        session, "selected_embedding_models", models_str, "string",
                        "选定的向量模型列表（逗号分隔）"
                    )
                    self.SELECTED_EMBEDDING_MODELS = selected_embedding_models
            
            # 重新加载配置以从提供商获取最新值
            self._load_llm_settings()
            
            return True
        except Exception as e:
            logger.error(f"保存LLM配置失败: {e}")
            return False
    
    def get_llm_provider_config(self) -> Optional[dict]:
        """获取当前选定的LLM提供商配置"""
        if not self.SELECTED_LLM_PROVIDER_ID:
            return None
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import LLMProviderRepository
            
            db = get_db()
            if not hasattr(db, 'engine'):
                return None
            
            with db.get_session() as session:
                provider = LLMProviderRepository.get_by_id(session, self.SELECTED_LLM_PROVIDER_ID)
                if provider and provider.enabled:
                    return {
                        "id": provider.id,
                        "name": provider.name,
                        "api_key": provider.api_key,
                        "api_base": provider.api_base,
                        "llm_model": provider.llm_model,
                        "llm_models": [m.strip() for m in provider.llm_model.split(",") if m.strip()],  # 解析为列表
                    }
        except Exception as e:
            logger.error(f"获取LLM提供商配置失败: {e}")
        
        return None
    
    def get_embedding_provider_config(self) -> Optional[dict]:
        """获取当前选定的向量模型提供商配置"""
        if not self.SELECTED_EMBEDDING_PROVIDER_ID:
            return None
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import LLMProviderRepository
            
            db = get_db()
            if not hasattr(db, 'engine'):
                return None
            
            with db.get_session() as session:
                provider = LLMProviderRepository.get_by_id(session, self.SELECTED_EMBEDDING_PROVIDER_ID)
                if provider and provider.enabled and provider.embedding_model:
                    return {
                        "id": provider.id,
                        "name": provider.name,
                        "api_key": provider.api_key,
                        "api_base": provider.api_base,
                        "embedding_model": provider.embedding_model,
                        "embedding_models": [m.strip() for m in provider.embedding_model.split(",") if m.strip()],  # 解析为列表
                    }
        except Exception as e:
            logger.error(f"获取向量模型提供商配置失败: {e}")
        
        return None
    
    def _load_image_settings(self):
        """加载图片生成配置（从数据库读取，支持运行时修改）"""
        if self._image_settings_loaded:
            return
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository, ImageProviderRepository
            
            db = get_db()
            # 确保数据库已初始化
            if not hasattr(db, 'engine'):
                return
            
            with db.get_session() as session:
                # 加载提供商选择配置
                selected_image_provider_id = AppSettingsRepository.get_setting(
                    session, "selected_image_provider_id", None
                )
                selected_image_models_str = AppSettingsRepository.get_setting(
                    session, "selected_image_models", ""
                )
                
                # 解析选定的模型列表
                if selected_image_models_str:
                    self.SELECTED_IMAGE_MODELS = [m.strip() for m in str(selected_image_models_str).split(",") if m.strip()]
                else:
                    self.SELECTED_IMAGE_MODELS = []
                
                # 从选定的提供商加载配置
                if selected_image_provider_id:
                    try:
                        provider = ImageProviderRepository.get_by_id(session, selected_image_provider_id)
                        if provider and provider.enabled:
                            self.SELECTED_IMAGE_PROVIDER_ID = selected_image_provider_id
                        else:
                            logger.warning(f"选定的图片生成提供商 {selected_image_provider_id} 不存在或未启用")
                    except Exception as e:
                        logger.warning(f"加载选定的图片生成提供商失败: {e}")
            
            logger.debug(f"图片生成配置加载完成: PROVIDER_ID={self.SELECTED_IMAGE_PROVIDER_ID}, "
                        f"MODELS={self.SELECTED_IMAGE_MODELS}")
            
            self._image_settings_loaded = True
        except Exception as e:
            # 如果数据库未初始化或读取失败，使用默认值
            logger.debug(f"从数据库加载图片生成配置失败: {e}")
    
    def load_image_settings(self):
        """公共方法：强制重新加载图片生成配置（从数据库读取最新值）"""
        self._image_settings_loaded = False
        self._load_image_settings()
    
    def save_image_settings(self, selected_image_provider_id: Optional[int] = None,
                            selected_image_models: Optional[List[str]] = None):
        """保存图片生成配置到数据库（只保存提供商选择）"""
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import AppSettingsRepository
            
            db = get_db()
            with db.get_session() as session:
                # 保存提供商选择
                if selected_image_provider_id is not None:
                    AppSettingsRepository.set_setting(
                        session, "selected_image_provider_id", selected_image_provider_id, "int",
                        "选定的图片生成提供商ID"
                    )
                    self.SELECTED_IMAGE_PROVIDER_ID = selected_image_provider_id
                
                # 保存选定的模型列表
                if selected_image_models is not None:
                    models_str = ",".join(selected_image_models)
                    AppSettingsRepository.set_setting(
                        session, "selected_image_models", models_str, "string",
                        "选定的图片生成模型列表（逗号分隔）"
                    )
                    self.SELECTED_IMAGE_MODELS = selected_image_models
            
            # 重新加载配置以从提供商获取最新值
            self._load_image_settings()
            
            return True
        except Exception as e:
            logger.error(f"保存图片生成配置失败: {e}")
            return False
    
    def get_image_provider_config(self) -> Optional[dict]:
        """获取当前选定的图片生成提供商配置"""
        if not self.SELECTED_IMAGE_PROVIDER_ID:
            return None
        
        try:
            from backend.app.db import get_db
            from backend.app.db.repositories import ImageProviderRepository
            
            db = get_db()
            if not hasattr(db, 'engine'):
                return None
            
            with db.get_session() as session:
                provider = ImageProviderRepository.get_by_id(session, self.SELECTED_IMAGE_PROVIDER_ID)
                if provider and provider.enabled:
                    return {
                        "id": provider.id,
                        "name": provider.name,
                        "api_key": provider.api_key,
                        "api_base": provider.api_base,
                        "image_model": provider.image_model,
                        "image_models": [m.strip() for m in provider.image_model.split(",") if m.strip()],  # 解析为列表
                    }
        except Exception as e:
            logger.error(f"获取图片生成提供商配置失败: {e}")
        
        return None
    
    def _load_collector_settings(self):
        """加载采集器配置（从数据库读取，支持运行时修改）"""
        if self._collector_settings_loaded:
            return
        
        session = self._get_db_session()
        if session is None:
            return
        
        try:
            with session as s:
                self.COLLECTION_CRON = self._load_setting(
                    s, "collection_cron", self.COLLECTION_CRON, "string"
                )
                self.COLLECTION_INTERVAL_HOURS = self._load_setting(
                    s, "collection_interval_hours", self.COLLECTION_INTERVAL_HOURS, "int"
                )
                self.MAX_ARTICLES_PER_SOURCE = self._load_setting(
                    s, "max_articles_per_source", self.MAX_ARTICLES_PER_SOURCE, "int"
                )
                self.REQUEST_TIMEOUT = self._load_setting(
                    s, "request_timeout", self.REQUEST_TIMEOUT, "int"
                )
            
            self._collector_settings_loaded = True
        except Exception as e:
            logger.debug(f"从数据库加载采集器配置失败，使用环境变量: {e}")
    
    def load_collector_settings(self):
        """公共方法：强制重新加载采集器配置（从数据库读取最新值）"""
        self._collector_settings_loaded = False
        self._load_collector_settings()
    
    def save_collector_settings(
        self, collection_interval_hours: int, max_articles_per_source: int, request_timeout: int
    ) -> bool:
        """保存采集器配置到数据库
        
        Args:
            collection_interval_hours: 采集间隔（小时）
            max_articles_per_source: 每次采集每源最多获取文章数
            request_timeout: 请求超时（秒）
            
        Returns:
            是否保存成功
        """
        try:
            from backend.app.db import get_db
            
            db = get_db()
            with db.get_session() as session:
                self._save_setting(
                    session, "collection_interval_hours", collection_interval_hours, "int",
                    "采集间隔（小时）"
                )
                self._save_setting(
                    session, "max_articles_per_source", max_articles_per_source, "int",
                    "每次采集每源最多获取文章数"
                )
                self._save_setting(
                    session, "request_timeout", request_timeout, "int",
                    "请求超时（秒）"
                )
            
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
        
        session = self._get_db_session()
        if session is None:
            return
        
        try:
            with session as s:
                self.NOTIFICATION_PLATFORM = self._load_setting(
                    s, "notification_platform", self.NOTIFICATION_PLATFORM, "string"
                )
                self.NOTIFICATION_WEBHOOK_URL = self._load_setting(
                    s, "notification_webhook_url", self.NOTIFICATION_WEBHOOK_URL, "string"
                )
                self.NOTIFICATION_SECRET = self._load_setting(
                    s, "notification_secret", self.NOTIFICATION_SECRET, "string"
                )
                self.INSTANT_NOTIFICATION_ENABLED = self._load_setting(
                    s, "instant_notification_enabled", self.INSTANT_NOTIFICATION_ENABLED, "bool"
                )

                quiet_hours_json = self._load_setting(
                    s, "notification_quiet_hours", "[]", "string"
                )
                try:
                    self.QUIET_HOURS = json.loads(quiet_hours_json) if quiet_hours_json else []
                except (json.JSONDecodeError, TypeError):
                    self.QUIET_HOURS = []
            
            if not self.NOTIFICATION_WEBHOOK_URL and self.FEISHU_BOT_WEBHOOK:
                self.NOTIFICATION_WEBHOOK_URL = self.FEISHU_BOT_WEBHOOK
                self.NOTIFICATION_PLATFORM = "feishu"
            
            self._notification_settings_loaded = True
        except Exception as e:
            logger.debug(f"从数据库加载通知配置失败，使用默认值: {e}")
    
    def save_notification_settings(
        self,
        platform: str,
        webhook_url: str,
        secret: str = "",
        instant_notification_enabled: bool = True,
        quiet_hours: Optional[List[Dict[str, str]]] = None
    ) -> bool:
        """保存通知配置到数据库
        
        Args:
            platform: 通知平台（feishu/dingtalk）
            webhook_url: 通知Webhook URL
            secret: 钉钉加签密钥（可选）
            instant_notification_enabled: 是否启用即时通知
            quiet_hours: 勿扰时段列表
            
        Returns:
            是否保存成功
        """
        try:
            from backend.app.db import get_db
            
            quiet_hours_list = quiet_hours if quiet_hours is not None else []
            
            db = get_db()
            with db.get_session() as session:
                self._save_setting(
                    session, "notification_platform", platform, "string",
                    "通知平台（feishu/dingtalk）"
                )
                self._save_setting(
                    session, "notification_webhook_url", webhook_url, "string",
                    "通知Webhook URL"
                )
                self._save_setting(
                    session, "notification_secret", secret, "string",
                    "钉钉加签密钥（可选）"
                )
                self._save_setting(
                    session, "instant_notification_enabled", instant_notification_enabled, "bool",
                    "是否启用即时通知"
                )
                self._save_setting(
                    session, "notification_quiet_hours", json.dumps(quiet_hours_list), "string",
                    "勿扰时段列表（JSON格式）"
                )
            
            self.NOTIFICATION_PLATFORM = platform
            self.NOTIFICATION_WEBHOOK_URL = webhook_url
            self.NOTIFICATION_SECRET = secret
            self.INSTANT_NOTIFICATION_ENABLED = instant_notification_enabled
            self.QUIET_HOURS = quiet_hours_list
            return True
        except Exception as e:
            logger.error(f"保存通知配置失败: {e}")
            return False
    
    def _load_social_media_settings(self):
        """加载社交平台配置（从数据库读取，支持运行时修改）"""
        if self._social_media_settings_loaded:
            return

        session = self._get_db_session()
        if session is None:
            self._load_social_media_from_env()
            return

        try:
            with session as s:
                self.YOUTUBE_API_KEY = self._load_setting(
                    s, "youtube_api_key", None, "string"
                )
                self.TIKTOK_API_KEY = self._load_setting(
                    s, "tiktok_api_key", None, "string"
                )
                self.TWITTER_API_KEY = self._load_setting(
                    s, "twitter_api_key", None, "string"
                )
                self.REDDIT_CLIENT_ID = self._load_setting(
                    s, "reddit_client_id", None, "string"
                )
                self.REDDIT_CLIENT_SECRET = self._load_setting(
                    s, "reddit_client_secret", None, "string"
                )
                self.REDDIT_USER_AGENT = self._load_setting(
                    s, "reddit_user_agent", None, "string"
                )
                self.SOCIAL_MEDIA_AUTO_REPORT_ENABLED = self._load_setting(
                    s, "social_media_auto_report_enabled", False, "bool"
                )
                self.SOCIAL_MEDIA_AUTO_REPORT_TIME = self._load_setting(
                    s, "social_media_auto_report_time", "09:00", "string"
                )
            
            logger.debug(
                f"社交平台配置加载: AUTO_REPORT_ENABLED={self.SOCIAL_MEDIA_AUTO_REPORT_ENABLED}, "
                f"AUTO_REPORT_TIME={self.SOCIAL_MEDIA_AUTO_REPORT_TIME}"
            )

            self._load_social_media_from_env()
            self._social_media_settings_loaded = True
        except Exception as e:
            logger.debug(f"从数据库加载社交平台配置失败，尝试从环境变量读取: {e}")
            self._load_social_media_from_env()
    
    def _load_social_media_from_env(self) -> None:
        """从环境变量加载社交平台配置（作为后备）"""
        if not self.YOUTUBE_API_KEY:
            self.YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", None)
        if not self.TIKTOK_API_KEY:
            self.TIKTOK_API_KEY = os.getenv("TIKTOK_API_KEY", None)
        if not self.TWITTER_API_KEY:
            self.TWITTER_API_KEY = os.getenv("TWITTER_API_KEY", None)
        if not self.REDDIT_CLIENT_ID:
            self.REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", None)
        if not self.REDDIT_CLIENT_SECRET:
            self.REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", None)
        if not self.REDDIT_USER_AGENT:
            self.REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", None)
    
    def load_social_media_settings(self):
        """公共方法：强制重新加载社交平台配置（从数据库读取最新值）"""
        self._social_media_settings_loaded = False
        self._load_social_media_settings()
    
    def save_social_media_settings(
        self,
        youtube_api_key: Optional[str] = None,
        tiktok_api_key: Optional[str] = None,
        twitter_api_key: Optional[str] = None,
        reddit_client_id: Optional[str] = None,
        reddit_client_secret: Optional[str] = None,
        reddit_user_agent: Optional[str] = None,
        auto_report_enabled: Optional[bool] = None,
        auto_report_time: Optional[str] = None
    ) -> bool:
        """保存社交平台配置到数据库
        
        Args:
            youtube_api_key: YouTube API密钥
            tiktok_api_key: TikTok API密钥
            twitter_api_key: Twitter API密钥
            reddit_client_id: Reddit客户端ID
            reddit_client_secret: Reddit客户端密钥
            reddit_user_agent: Reddit用户代理
            auto_report_enabled: 是否启用定时生成AI小报
            auto_report_time: 定时生成时间（格式：HH:MM）
            
        Returns:
            是否保存成功
        """
        try:
            from backend.app.db import get_db
            
            db = get_db()
            with db.get_session() as session:
                settings_map = [
                    (youtube_api_key, "youtube_api_key", "YouTube API密钥", "YOUTUBE_API_KEY"),
                    (tiktok_api_key, "tiktok_api_key", "TikTok API密钥", "TIKTOK_API_KEY"),
                    (twitter_api_key, "twitter_api_key", "Twitter API密钥", "TWITTER_API_KEY"),
                    (reddit_client_id, "reddit_client_id", "Reddit客户端ID", "REDDIT_CLIENT_ID"),
                    (reddit_client_secret, "reddit_client_secret", "Reddit客户端密钥", "REDDIT_CLIENT_SECRET"),
                    (reddit_user_agent, "reddit_user_agent", "Reddit用户代理", "REDDIT_USER_AGENT"),
                ]
                
                for value, key, description, attr_name in settings_map:
                    # 允许保存None和空字符串，None表示不更新，空字符串表示清空
                    # 使用一个特殊标记来区分"不更新"和"清空"
                    # 如果value是None，表示不更新该字段
                    # 如果value是空字符串，表示清空该字段
                    # 这里我们使用一个技巧：如果前端发送了字段（即使是空字符串），我们就保存
                    # 但为了兼容，我们检查value是否为None
                    if value is not None:
                        # 保存值（包括空字符串）
                        self._save_setting(session, key, value, "string", description)
                        setattr(self, attr_name, value)
                    # 如果value是None，不更新该字段（保持原值）
                
                if auto_report_enabled is not None:
                    self._save_setting(
                        session, "social_media_auto_report_enabled", auto_report_enabled, "bool",
                        "是否启用定时生成AI小报"
                    )
                    self.SOCIAL_MEDIA_AUTO_REPORT_ENABLED = auto_report_enabled

                if auto_report_time is not None:
                    self._save_setting(
                        session, "social_media_auto_report_time", auto_report_time, "string",
                        "定时生成时间（格式：HH:MM）"
                    )
                    self.SOCIAL_MEDIA_AUTO_REPORT_TIME = auto_report_time
                
                # 显式刷新确保数据被写入（提交由上下文管理器处理）
                session.flush()
            
            logger.info(f"✅ 社交平台配置已保存: youtube_api_key={'***' if youtube_api_key else None}, tiktok_api_key={'***' if tiktok_api_key else None}, twitter_api_key={'***' if twitter_api_key else None}, reddit_client_id={'***' if reddit_client_id else None}, auto_report_enabled={auto_report_enabled}, auto_report_time={auto_report_time}")
            return True
        except Exception as e:
            logger.error(f"保存社交平台配置失败: {e}", exc_info=True)
            return False
    
    def get_social_media_auto_report_cron(self) -> Optional[str]:
        """根据定时生成时间生成cron表达式"""
        if not self.SOCIAL_MEDIA_AUTO_REPORT_ENABLED:
            return None
        
        try:
            hour, minute = self.SOCIAL_MEDIA_AUTO_REPORT_TIME.split(":")
            hour = int(hour)
            minute = int(minute)
            # cron格式: 分 时 日 月 周（每天执行）
            return f"{minute} {hour} * * *"
        except (ValueError, AttributeError):
            return None


# 全局配置实例
settings = Settings()

