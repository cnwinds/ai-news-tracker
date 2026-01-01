"""
统一配置管理模块
"""
import os
import json
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """应用配置类"""

    def __init__(self):
        self._load_env()

    def _load_env(self):
        """加载环境变量"""
        # OpenAI API配置
        self.OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
        self.OPENAI_API_BASE: str = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
        self.OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4-turbo-preview")

        # 飞书机器人配置
        self.FEISHU_BOT_WEBHOOK: str = os.getenv("FEISHU_BOT_WEBHOOK", "")

        # 数据库配置
        self.DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./data/ai_news.db")

        # 定时任务配置
        self.COLLECTION_CRON: str = os.getenv("COLLECTION_CRON", "0 */1 * * *")
        self.DAILY_SUMMARY_CRON: str = os.getenv("DAILY_SUMMARY_CRON", "0 9 * * *")

        # 采集配置
        self.MAX_WORKERS: int = int(os.getenv("MAX_WORKERS", "3"))
        self.REQUEST_TIMEOUT: int = int(os.getenv("REQUEST_TIMEOUT", "30"))
        self.MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "3"))
        self.MAX_ARTICLES_PER_SOURCE: int = int(os.getenv("MAX_ARTICLES_PER_SOURCE", "50"))

        # Web配置
        self.WEB_HOST: str = os.getenv("WEB_HOST", "0.0.0.0")
        self.WEB_PORT: int = int(os.getenv("WEB_PORT", "8501"))

        # 日志配置
        self.LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
        self.LOG_FILE: Optional[str] = os.getenv("LOG_FILE")

        # 项目根目录
        self.PROJECT_ROOT: Path = Path(__file__).parent.parent
        self.DATA_DIR: Path = self.PROJECT_ROOT / "data"
        self.CONFIG_DIR: Path = self.PROJECT_ROOT / "config"

        # 确保必要目录存在
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        
        # 文章过滤配置（从配置文件读取，支持运行时修改）
        # 注意：必须在CONFIG_DIR设置之后调用
        self._load_collection_settings()
        
        # 文章过滤配置（从配置文件读取，支持运行时修改）
        # 注意：必须在CONFIG_DIR设置之后调用
        self._load_collection_settings()

    def is_ai_enabled(self) -> bool:
        """检查AI分析是否启用"""
        return bool(self.OPENAI_API_KEY)

    def is_feishu_enabled(self) -> bool:
        """检查飞书通知是否启用"""
        return bool(self.FEISHU_BOT_WEBHOOK)
    
    def _load_collection_settings(self):
        """加载采集配置（从JSON文件读取，支持运行时修改）"""
        collection_settings_path = self.CONFIG_DIR / "collection_settings.json"
        try:
            with open(collection_settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
                self.MAX_ARTICLE_AGE_DAYS: int = int(settings.get("max_article_age_days", 30))
                self.MAX_ANALYSIS_AGE_DAYS: int = int(settings.get("max_analysis_age_days", 7))
        except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError) as e:
            # 如果文件不存在或解析失败，使用默认值
            self.MAX_ARTICLE_AGE_DAYS: int = int(os.getenv("MAX_ARTICLE_AGE_DAYS", "30"))
            self.MAX_ANALYSIS_AGE_DAYS: int = int(os.getenv("MAX_ANALYSIS_AGE_DAYS", "7"))
    
    def save_collection_settings(self, max_article_age_days: int, max_analysis_age_days: int):
        """保存采集配置到JSON文件"""
        import json
        collection_settings_path = self.CONFIG_DIR / "collection_settings.json"
        settings = {
            "max_article_age_days": max_article_age_days,
            "max_analysis_age_days": max_analysis_age_days
        }
        try:
            with open(collection_settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2, ensure_ascii=False)
            # 重新加载配置
            self._load_collection_settings()
            return True
        except Exception as e:
            print(f"保存采集配置失败: {e}")
            return False


# 全局配置实例
settings = Settings()
