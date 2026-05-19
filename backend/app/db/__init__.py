"""
数据库初始化和管理
"""
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Generator, Optional

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from backend.app.db.models import Base
from backend.app.db.repositories import (
    ArticleRepository,
    RSSSourceRepository,
    CollectionTaskRepository,
    CollectionLogRepository,
)

logger = logging.getLogger(__name__)


def get_embedding_dimension(embedding_model: str) -> int:
    """
    根据嵌入模型名称获取向量维度
    
    Args:
        embedding_model: 嵌入模型名称
        
    Returns:
        向量维度
    """
    # 常见模型的维度映射
    model_dimensions = {
        "text-embedding-3-small": 1024,  # 修正：text-embedding-3-small 实际是 1024 维
        "text-embedding-3-large": 3072,
        "text-embedding-ada-002": 1536,
        "text-embedding-v4": 1024,
        "text-embedding-v3": 1536,
        "text-embedding-v2": 1536,
        "text-embedding-v1": 1536,
    }
    
    # 尝试精确匹配
    if embedding_model in model_dimensions:
        return model_dimensions[embedding_model]
    
    # 尝试部分匹配（处理带路径或前缀的模型名）
    for model_name, dimension in model_dimensions.items():
        if model_name in embedding_model:
            return dimension
    
    # 默认返回 1536（最常用的维度）
    logger.warning(f"⚠️  未知的嵌入模型 '{embedding_model}'，使用默认维度 1536")
    return 1536


class DatabaseManager:
    """数据库管理器"""

    def __init__(self, database_url: str = None, legacy_database_url: str = None):
        # 默认使用 settings.DATABASE_URL，避免数据库默认路径在多个模块中漂移
        from backend.app.core.settings import settings

        if database_url is None:
            database_url = settings.DATABASE_URL

        if legacy_database_url is None:
            legacy_database_url = settings.LEGACY_DATABASE_URL
        
        self.database_url = database_url
        self.legacy_database_url = legacy_database_url
        self.auto_migrate_legacy_database = settings.AUTO_MIGRATE_LEGACY_DATABASE

        # 确保数据目录存在
        if database_url.startswith("sqlite:///"):
            db_path = database_url.replace("sqlite:///", "")
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)

        # 创建引擎
        connect_args = {}
        if "sqlite" in database_url:
            connect_args["check_same_thread"] = False
            connect_args["timeout"] = 30
        
        self.engine = create_engine(
            database_url,
            connect_args=connect_args,
            echo=False,
        )
        
        # 为 SQLite 连接注册事件监听器，确保数据被持久化
        if database_url.startswith("sqlite:///"):
            @event.listens_for(self.engine, "connect")
            def set_sqlite_pragma(dbapi_conn, connection_record):
                """设置 SQLite 连接参数，提升 Web 服务读写并发稳定性"""
                cursor = dbapi_conn.cursor()
                # 启用外键约束
                cursor.execute("PRAGMA foreign_keys=ON")
                # 等待短暂写锁释放，避免并发采集期间读请求直接 500
                cursor.execute("PRAGMA busy_timeout=30000")
                # WAL 模式下 NORMAL 在持久性和并发性能之间更适合 Web 服务
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.close()

            self._enable_sqlite_wal()
        
        # 为 SQLite 连接注册事件监听器，在每次连接时加载 sqlite-vec 扩展
        if database_url.startswith("sqlite:///"):
            self._setup_sqlite_vec_loader()

        # 创建会话工厂
        self.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=self.engine)

        # 初始化数据库
        self.init_db()

    def _enable_sqlite_wal(self):
        """启用 WAL，允许读请求与后台写入任务并发执行。"""
        try:
            with self.engine.connect() as conn:
                conn.execute(text("PRAGMA journal_mode=WAL"))
                conn.execute(text("PRAGMA wal_autocheckpoint=1000"))
                conn.commit()
        except Exception as e:
            logger.warning(f"⚠️  启用 SQLite WAL 模式失败，将继续使用当前日志模式: {e}")

    def init_db(self):
        """初始化数据库表（第一阶段：只创建基础表结构）"""
        try:
            Base.metadata.create_all(bind=self.engine)
            self._migrate_legacy_ai_news_database()
            self._drop_legacy_knowledge_graph_tables()
            # 注意：不在这里初始化 vec0 虚拟表，避免循环依赖
            # vec0 表的初始化将在配置加载后通过 init_sqlite_vec_table() 完成
            
            # 迁移：添加 is_favorited 字段（如果不存在）
            self._migrate_add_is_favorited()
            
            # 迁移：添加 user_notes 字段（如果不存在）
            self._migrate_add_user_notes()
            
            # 迁移：添加采集源自定义字段（如果不存在）
            self._migrate_add_source_customization()
            
            # 迁移：添加提供商类型字段（如果不存在）
            self._migrate_add_provider_type()
            
            # 迁移：添加源子类型字段（如果不存在）
            self._migrate_add_sub_type()
            
            # 升级：将老格式的sub_type从extra_config中提取并写入sub_type字段
            self._upgrade_sub_type_fields()
            
            # 迁移：添加 Reddit 字段到社交平台报告表（如果不存在）
            self._migrate_add_reddit_fields()
            
            # 迁移：添加 detailed_summary 字段并迁移现有 summary 数据
            self._migrate_add_detailed_summary()

            # 升级：探索模型唯一标识（从 model_name 迁移到 source_platform+source_uid）
            self._upgrade_exploration_model_identity()

            # 迁移：补齐 discovered_models 活动字段（兼容旧库）
            self._migrate_add_model_activity_fields()

            # 迁移：补齐 access_logs 新增字段（兼容旧库）
            self._migrate_add_access_log_fields()
             
            logger.info("✅ 数据库基础表初始化成功")
        except Exception as e:
            logger.error(f"❌ 数据库初始化失败: {e}")
            raise

    def _drop_legacy_knowledge_graph_tables(self):
        """删除旧版知识图谱表和配置键。新版行业图谱不复用旧数据。"""
        try:
            from sqlalchemy import text

            legacy_tables = [
                "knowledge_graph_edges",
                "knowledge_graph_article_states",
                "knowledge_graph_builds",
                "knowledge_graph_nodes",
            ]
            with self.engine.connect() as conn:
                for table_name in legacy_tables:
                    conn.execute(text(f"DROP TABLE IF EXISTS {table_name}"))
                conn.execute(
                    text(
                        """
                        DELETE FROM app_settings
                        WHERE key LIKE 'knowledge_graph_%'
                           OR key IN (
                               'selected_knowledge_graph_provider_id',
                               'selected_knowledge_graph_models'
                           )
                        """
                    )
                )
                conn.commit()
            logger.info("✅ 旧版知识图谱表和配置已清理")
        except Exception as e:
            logger.warning(f"⚠️  清理旧版知识图谱表失败: {e}")

    def _sqlite_path_from_url(self, database_url: Optional[str]) -> Optional[Path]:
        """从 SQLite URL 提取文件路径。仅支持本地文件库。"""
        if not database_url or not database_url.startswith("sqlite:///"):
            return None
        raw_path = database_url.replace("sqlite:///", "", 1)
        if not raw_path or raw_path == ":memory:":
            return None
        return Path(raw_path).expanduser().resolve()

    def _migrate_legacy_ai_news_database(self):
        """从旧 ai_news.db 迁移文章和运行所需配置到新库。

        新版行业图谱不复用旧知识图谱数据，因此这里采用白名单表迁移。
        迁移完成后会在 app_settings 中写入标记，后续启动不会重复执行。
        """
        if not self.auto_migrate_legacy_database:
            logger.info("ℹ️  旧库自动迁移已关闭")
            return

        target_path = self._sqlite_path_from_url(self.database_url)
        legacy_path = self._sqlite_path_from_url(self.legacy_database_url)
        if not target_path or not legacy_path:
            logger.info("ℹ️  当前数据库不是本地 SQLite 文件，跳过旧库自动迁移")
            return
        if target_path == legacy_path:
            logger.info("ℹ️  新旧数据库路径相同，跳过旧库复制迁移，仅执行结构升级")
            return
        if not legacy_path.exists():
            logger.info("ℹ️  未发现旧数据库 %s，跳过旧库自动迁移", legacy_path)
            return

        marker_key = "legacy_ai_news_migration_completed_at"
        try:
            with self.engine.connect() as conn:
                existing_marker = conn.execute(
                    text("SELECT value FROM app_settings WHERE key = :key"),
                    {"key": marker_key},
                ).fetchone()
                if existing_marker:
                    logger.info("ℹ️  旧库迁移已完成，跳过重复迁移")
                    return
        except Exception as e:
            logger.warning("⚠️  检查旧库迁移标记失败，将尝试继续迁移: %s", e)

        logger.info("🔄 检测到旧数据库，开始迁移文章和基础配置: %s -> %s", legacy_path, target_path)
        migrated_counts = {}
        source_conn = sqlite3.connect(str(legacy_path))
        source_conn.row_factory = sqlite3.Row
        try:
            for table_name in [
                "rss_sources",
                "articles",
                "app_settings",
                "llm_providers",
                "image_providers",
            ]:
                migrated_counts[table_name] = self._copy_legacy_table(source_conn, table_name)

            with self.engine.connect() as conn:
                conn.execute(
                    text(
                        """
                        INSERT OR REPLACE INTO app_settings
                            (key, value, value_type, description, created_at, updated_at)
                        VALUES
                            (:key, :value, 'string', :description, :created_at, :updated_at)
                        """
                    ),
                    {
                        "key": marker_key,
                        "value": datetime.now().isoformat(timespec="seconds"),
                        "description": f"旧 ai_news.db 自动迁移完成，来源：{legacy_path}",
                        "created_at": datetime.now(),
                        "updated_at": datetime.now(),
                    },
                )
                conn.commit()
            logger.info("✅ 旧库迁移完成: %s", migrated_counts)
        except Exception as e:
            logger.warning("⚠️  旧库自动迁移失败，应用会继续启动，请检查后手动迁移: %s", e, exc_info=True)
        finally:
            source_conn.close()

    def _copy_legacy_table(self, source_conn: sqlite3.Connection, table_name: str) -> int:
        """按目标库已有结构拷贝旧表交集字段。"""
        if not self._legacy_table_exists(source_conn, table_name):
            return 0

        source_columns = self._legacy_table_columns(source_conn, table_name)
        if not source_columns:
            return 0

        with self.engine.connect() as conn:
            target_columns = [
                row[1]
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
            ]
        copy_columns = [column for column in source_columns if column in target_columns]
        default_values = self._legacy_table_default_values(table_name)
        default_columns = [
            column
            for column in target_columns
            if column not in copy_columns and column in default_values
        ]
        insert_columns = [*copy_columns, *default_columns]
        if not insert_columns:
            return 0

        quoted_copy_columns = ", ".join(f'"{column}"' for column in copy_columns)
        where_clause = ""
        params = []
        if table_name == "app_settings" and "key" in copy_columns:
            where_clause = """
                WHERE key NOT LIKE 'knowledge_graph_%'
                  AND key NOT IN (
                      'selected_knowledge_graph_provider_id',
                      'selected_knowledge_graph_models'
                  )
            """

        rows = source_conn.execute(
            f"SELECT {quoted_copy_columns} FROM {table_name} {where_clause}"
        ).fetchall()
        if not rows:
            return 0

        quoted_insert_columns = ", ".join(f'"{column}"' for column in insert_columns)
        placeholders = ", ".join(f":{column}" for column in insert_columns)
        insert_sql = text(
            f"INSERT OR IGNORE INTO {table_name} ({quoted_insert_columns}) VALUES ({placeholders})"
        )
        for row in rows:
            item = {column: row[column] for column in copy_columns}
            for column in default_columns:
                value = default_values[column]
                item[column] = value() if callable(value) else value
            params.append(item)

        inserted = 0
        with self.engine.connect() as conn:
            result = conn.execute(insert_sql, params)
            conn.commit()
            inserted = int(result.rowcount or 0)
        return inserted

    def _legacy_table_exists(self, source_conn: sqlite3.Connection, table_name: str) -> bool:
        row = source_conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        ).fetchone()
        return row is not None

    def _legacy_table_columns(self, source_conn: sqlite3.Connection, table_name: str) -> list[str]:
        rows = source_conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        return [row[1] for row in rows]

    def _legacy_table_default_values(self, table_name: str) -> dict[str, object]:
        now = lambda: datetime.now()
        defaults = {
            "rss_sources": {
                "source_type": "rss",
                "language": "en",
                "enabled": 1,
                "priority": 1,
                "created_at": now,
                "updated_at": now,
            },
            "articles": {
                "collected_at": now,
                "is_processed": 0,
                "is_sent": 0,
                "is_favorited": 0,
                "created_at": now,
                "updated_at": now,
            },
            "app_settings": {
                "value_type": "string",
                "created_at": now,
                "updated_at": now,
            },
            "llm_providers": {
                "provider_type": "大模型(OpenAI)",
                "enabled": 1,
                "created_at": now,
                "updated_at": now,
            },
            "image_providers": {
                "provider_type": "文生图(BaiLian)",
                "enabled": 1,
                "created_at": now,
                "updated_at": now,
            },
        }
        return defaults.get(table_name, {})

    def _migrate_add_is_favorited(self):
        """迁移：为 articles 表添加 is_favorited 字段（如果不存在）"""
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(self.engine)
            columns = [col['name'] for col in inspector.get_columns('articles')]
            
            if 'is_favorited' not in columns:
                logger.info("🔄 检测到缺少 is_favorited 字段，正在添加...")
                with self.engine.connect() as conn:
                    # SQLite 不支持直接添加带默认值的列，需要分步操作
                    conn.execute(text("""
                        ALTER TABLE articles 
                        ADD COLUMN is_favorited BOOLEAN DEFAULT 0
                    """))
                    conn.commit()
                logger.info("✅ is_favorited 字段添加成功")
        except Exception as e:
            # 如果字段已存在或其他错误，记录但不中断
            logger.debug(f"is_favorited 字段迁移检查: {e}")

    def _migrate_add_user_notes(self):
        """迁移：为 articles 表添加 user_notes 字段（如果不存在）"""
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(self.engine)
            columns = [col['name'] for col in inspector.get_columns('articles')]
            
            if 'user_notes' not in columns:
                logger.info("🔄 检测到缺少 user_notes 字段，正在添加...")
                with self.engine.connect() as conn:
                    conn.execute(text("""
                        ALTER TABLE articles 
                        ADD COLUMN user_notes TEXT
                    """))
                    conn.commit()
                logger.info("✅ user_notes 字段添加成功")
        except Exception as e:
            # 如果字段已存在或其他错误，记录但不中断
            logger.debug(f"user_notes 字段迁移检查: {e}")

    def _migrate_add_provider_type(self):
        """迁移：为 llm_providers 和 image_providers 表添加 provider_type 字段（如果不存在）"""
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(self.engine)
            
            # 检查 llm_providers 表
            try:
                llm_columns = [col['name'] for col in inspector.get_columns('llm_providers')]
                if 'provider_type' not in llm_columns:
                    logger.info("🔄 检测到 llm_providers 表缺少 provider_type 字段，正在添加...")
                    with self.engine.connect() as conn:
                        conn.execute(text("""
                            ALTER TABLE llm_providers 
                            ADD COLUMN provider_type VARCHAR(50) DEFAULT '大模型(OpenAI)'
                        """))
                        # 更新现有记录的默认值
                        conn.execute(text("""
                            UPDATE llm_providers 
                            SET provider_type = '大模型(OpenAI)' 
                            WHERE provider_type IS NULL
                        """))
                        conn.commit()
                    logger.info("✅ llm_providers.provider_type 字段添加成功")
            except Exception as e:
                logger.debug(f"llm_providers 表迁移检查: {e}")
            
            # 检查 image_providers 表
            try:
                image_columns = [col['name'] for col in inspector.get_columns('image_providers')]
                if 'provider_type' not in image_columns:
                    logger.info("🔄 检测到 image_providers 表缺少 provider_type 字段，正在添加...")
                    with self.engine.connect() as conn:
                        conn.execute(text("""
                            ALTER TABLE image_providers 
                            ADD COLUMN provider_type VARCHAR(50) DEFAULT '文生图(BaiLian)'
                        """))
                        # 更新现有记录的默认值
                        conn.execute(text("""
                            UPDATE image_providers 
                            SET provider_type = '文生图(BaiLian)' 
                            WHERE provider_type IS NULL
                        """))
                        conn.commit()
                    logger.info("✅ image_providers.provider_type 字段添加成功")
            except Exception as e:
                logger.debug(f"image_providers 表迁移检查: {e}")
        except Exception as e:
            # 如果表不存在或其他错误，记录但不中断
            logger.debug(f"provider_type 字段迁移检查: {e}")

    def _migrate_add_source_customization(self):
        """迁移：为 rss_sources 表添加 analysis_prompt 和 parse_fix_history 字段（如果不存在）"""
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(self.engine)
            columns = [col['name'] for col in inspector.get_columns('rss_sources')]
            
            # 添加 analysis_prompt 字段
            if 'analysis_prompt' not in columns:
                logger.info("🔄 检测到缺少 analysis_prompt 字段，正在添加...")
                with self.engine.connect() as conn:
                    conn.execute(text("""
                        ALTER TABLE rss_sources 
                        ADD COLUMN analysis_prompt TEXT
                    """))
                    conn.commit()
                logger.info("✅ analysis_prompt 字段添加成功")
            
            # 添加 parse_fix_history 字段
            if 'parse_fix_history' not in columns:
                logger.info("🔄 检测到缺少 parse_fix_history 字段，正在添加...")
                with self.engine.connect() as conn:
                    conn.execute(text("""
                        ALTER TABLE rss_sources 
                        ADD COLUMN parse_fix_history TEXT
                    """))
                    conn.commit()
                logger.info("✅ parse_fix_history 字段添加成功")
        except Exception as e:
            # 如果字段已存在或其他错误，记录但不中断
            logger.debug(f"采集源自定义字段迁移检查: {e}")

    def _migrate_add_sub_type(self):
        """迁移：为 rss_sources 表添加 sub_type 字段（如果不存在）"""
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(self.engine)
            columns = [col['name'] for col in inspector.get_columns('rss_sources')]
            
            # 添加 sub_type 字段
            if 'sub_type' not in columns:
                logger.info("🔄 检测到缺少 sub_type 字段，正在添加...")
                with self.engine.connect() as conn:
                    conn.execute(text("""
                        ALTER TABLE rss_sources 
                        ADD COLUMN sub_type VARCHAR(50)
                    """))
                    conn.commit()
                logger.info("✅ sub_type 字段添加成功")
        except Exception as e:
            # 如果字段已存在或其他错误，记录但不中断
            logger.debug(f"sub_type 字段迁移检查: {e}")

    def _upgrade_sub_type_fields(self):
        """升级：将老格式的sub_type从extra_config中提取并写入sub_type字段"""
        try:
            from backend.app.db.migrations.upgrade_sub_type import upgrade_sub_type_fields
            upgrade_sub_type_fields(self.engine)
        except Exception as e:
            # 如果升级失败，记录但不中断
            logger.warning(f"⚠️  升级sub_type字段失败: {e}")

    def _upgrade_exploration_model_identity(self):
        """升级：探索模型唯一标识改为 source_platform+source_uid"""
        try:
            from backend.app.db.migrations.upgrade_exploration_model_identity import (
                upgrade_exploration_model_identity,
            )

            upgraded = upgrade_exploration_model_identity(self.engine)
            if upgraded:
                logger.info("✅ exploration 模型标识升级完成")
        except Exception as e:
            logger.warning(f"⚠️  exploration 模型标识升级失败: {e}")

    def _migrate_add_model_activity_fields(self):
        """迁移：为 discovered_models 表补齐活动字段"""
        try:
            from sqlalchemy import inspect, text

            inspector = inspect(self.engine)
            try:
                columns = {col['name'] for col in inspector.get_columns('discovered_models')}
            except Exception:
                logger.debug("discovered_models 表不存在，跳过活动字段迁移")
                return

            alter_sql_map = {
                'last_activity_at': "ALTER TABLE discovered_models ADD COLUMN last_activity_at TIMESTAMP",
                'activity_type': "ALTER TABLE discovered_models ADD COLUMN activity_type VARCHAR(50)",
                'activity_confidence': "ALTER TABLE discovered_models ADD COLUMN activity_confidence REAL",
            }

            with self.engine.connect() as conn:
                for field, sql in alter_sql_map.items():
                    if field in columns:
                        continue
                    logger.info(f"🔄 检测到 discovered_models 缺少 {field} 字段，正在添加...")
                    conn.execute(text(sql))
                conn.commit()

                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS idx_model_last_activity "
                        "ON discovered_models(last_activity_at)"
                    )
                )
                conn.commit()
            logger.info("✅ discovered_models 活动字段迁移完成")
        except Exception as e:
            logger.warning(f"⚠️  discovered_models 活动字段迁移失败: {e}")

    def _migrate_add_access_log_fields(self):
        """迁移：为 access_logs 表补齐历史版本缺失字段"""
        try:
            from sqlalchemy import inspect, text

            inspector = inspect(self.engine)
            try:
                columns = {col['name'] for col in inspector.get_columns('access_logs')}
            except Exception:
                logger.debug("access_logs 表不存在，跳过字段迁移")
                return

            alter_sql_map = {
                'ip_address': "ALTER TABLE access_logs ADD COLUMN ip_address VARCHAR(50)",
                'user_agent': "ALTER TABLE access_logs ADD COLUMN user_agent VARCHAR(500)",
                'extra_data': "ALTER TABLE access_logs ADD COLUMN extra_data JSON",
                'last_activity_at': "ALTER TABLE access_logs ADD COLUMN last_activity_at TIMESTAMP",
                'activity_type': "ALTER TABLE access_logs ADD COLUMN activity_type VARCHAR(50)",
                'activity_confidence': "ALTER TABLE access_logs ADD COLUMN activity_confidence REAL",
            }

            with self.engine.connect() as conn:
                for field, sql in alter_sql_map.items():
                    if field in columns:
                        continue
                    logger.info(f"🔄 检测到 access_logs 缺少 {field} 字段，正在添加...")
                    conn.execute(text(sql))
                conn.commit()

                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS idx_access_last_activity_at "
                        "ON access_logs(last_activity_at)"
                    )
                )
                conn.commit()
            logger.info("✅ access_logs 字段迁移完成")
        except Exception as e:
            logger.warning(f"⚠️  access_logs 字段迁移失败: {e}")

    def _migrate_add_detailed_summary(self):
        """迁移：为 articles 表添加 detailed_summary 字段，并将现有 summary 数据迁移到 detailed_summary"""
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(self.engine)
            
            # 检查 articles 表是否存在
            try:
                columns = [col['name'] for col in inspector.get_columns('articles')]
            except Exception:
                # 表不存在，跳过迁移
                logger.debug("articles 表不存在，跳过 detailed_summary 字段迁移")
                return
            
            # 添加 detailed_summary 字段
            if 'detailed_summary' not in columns:
                logger.info("🔄 检测到缺少 detailed_summary 字段，正在添加...")
                with self.engine.connect() as conn:
                    conn.execute(text("""
                        ALTER TABLE articles 
                        ADD COLUMN detailed_summary TEXT
                    """))
                    conn.commit()
                logger.info("✅ detailed_summary 字段添加成功")
                
                # 迁移现有数据：将现有的 summary 数据复制到 detailed_summary
                # 因为现有的 summary 实际上是精读内容
                logger.info("🔄 开始迁移现有 summary 数据到 detailed_summary...")
                with self.engine.connect() as conn:
                    result = conn.execute(text("""
                        UPDATE articles 
                        SET detailed_summary = summary 
                        WHERE summary IS NOT NULL AND summary != ''
                    """))
                    migrated_count = result.rowcount
                    conn.commit()
                logger.info(f"✅ 已迁移 {migrated_count} 条记录的 summary 数据到 detailed_summary")
            else:
                logger.debug("detailed_summary 字段已存在，跳过迁移")
        except Exception as e:
            # 如果字段已存在或其他错误，记录但不中断
            logger.warning(f"⚠️  detailed_summary 字段迁移检查失败: {e}")

    def _migrate_add_reddit_fields(self):
        """迁移：为 social_media_reports 表添加 reddit_count 和 reddit_enabled 字段（如果不存在）"""
        try:
            from sqlalchemy import inspect, text
            inspector = inspect(self.engine)
            
            # 检查表是否存在
            try:
                columns = [col['name'] for col in inspector.get_columns('social_media_reports')]
            except Exception:
                # 表不存在，跳过迁移
                logger.debug("social_media_reports 表不存在，跳过 Reddit 字段迁移")
                return
            
            # 添加 reddit_count 字段
            if 'reddit_count' not in columns:
                logger.info("🔄 检测到缺少 reddit_count 字段，正在添加...")
                with self.engine.connect() as conn:
                    conn.execute(text("""
                        ALTER TABLE social_media_reports 
                        ADD COLUMN reddit_count INTEGER DEFAULT 0
                    """))
                    # 更新现有记录的默认值
                    conn.execute(text("""
                        UPDATE social_media_reports 
                        SET reddit_count = 0 
                        WHERE reddit_count IS NULL
                    """))
                    conn.commit()
                logger.info("✅ reddit_count 字段添加成功")
            
            # 添加 reddit_enabled 字段
            if 'reddit_enabled' not in columns:
                logger.info("🔄 检测到缺少 reddit_enabled 字段，正在添加...")
                with self.engine.connect() as conn:
                    conn.execute(text("""
                        ALTER TABLE social_media_reports 
                        ADD COLUMN reddit_enabled BOOLEAN DEFAULT 0
                    """))
                    # 更新现有记录的默认值
                    conn.execute(text("""
                        UPDATE social_media_reports 
                        SET reddit_enabled = 0 
                        WHERE reddit_enabled IS NULL
                    """))
                    conn.commit()
                logger.info("✅ reddit_enabled 字段添加成功")
        except Exception as e:
            # 如果字段已存在或其他错误，记录但不中断
            logger.debug(f"Reddit 字段迁移检查: {e}")

    def init_sqlite_vec_table(self, embedding_model: str = None):
        """
        初始化sqlite-vec扩展和vec0虚拟表（第二阶段：在配置加载后调用）
        
        Args:
            embedding_model: 嵌入模型名称，如果为None则使用默认值
        """
        try:
            # 获取SQLite连接路径
            if not self.database_url.startswith("sqlite:///"):
                logger.warning("⚠️  sqlite-vec仅支持SQLite数据库")
                return
            
            # 检查 SQLite 版本（sqlite-vec 需要 3.41+）
            sqlite_version = sqlite3.sqlite_version_info
            if sqlite_version < (3, 41, 0):
                logger.warning(f"⚠️  SQLite版本 {sqlite3.sqlite_version} 过低，sqlite-vec需要3.41+，将使用Python向量计算")
                return
            
            db_path = self.database_url.replace("sqlite:///", "")
            
            # 尝试导入 sqlite_vec 模块
            try:
                import sqlite_vec
            except ImportError:
                logger.warning("⚠️  sqlite-vec模块未安装，将使用Python向量计算")
                return
            
            # 确定嵌入模型和维度
            if not embedding_model:
                # 如果没有提供，尝试从全局 settings 读取
                try:
                    from backend.app.core.settings import settings
                    embedding_model = settings.OPENAI_EMBEDDING_MODEL
                except Exception:
                    embedding_model = "text-embedding-3-small"
            
            dimension = get_embedding_dimension(embedding_model)
            logger.info(f"📊 使用嵌入模型: {embedding_model}，维度: {dimension}")
            
            # 使用原生SQLite连接加载扩展
            conn = sqlite3.connect(db_path)
            conn.enable_load_extension(True)
            
            try:
                # 加载 sqlite-vec 扩展
                sqlite_vec.load(conn)
                
                # 创建vec0虚拟表（如果不存在）
                with conn:
                    # 检查表是否已存在
                    cursor = conn.execute("""
                        SELECT name FROM sqlite_master 
                        WHERE type='table' AND name='vec_embeddings'
                    """)
                    table_exists = cursor.fetchone() is not None
                    
                    if not table_exists:
                        # 创建vec0虚拟表，使用余弦距离（适合大多数嵌入模型）
                        try:
                            conn.execute(f"""
                                CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                                    article_id INTEGER PRIMARY KEY,
                                    embedding float[{dimension}] DISTANCE_METRIC=cosine
                                )
                            """)
                            logger.info(f"✅ vec0虚拟表创建成功（维度: {dimension}，使用余弦距离）")
                        except sqlite3.OperationalError as e:
                            if "no such module: vec0" in str(e):
                                logger.warning(f"⚠️  sqlite-vec扩展不可用，将使用Python向量计算: {e}")
                                return
                            else:
                                raise
                    else:
                        # 表已存在，检查维度是否匹配
                        # 注意：vec0 表一旦创建，维度就固定了，无法修改
                        logger.info("ℹ️  vec0虚拟表已存在，检查维度是否匹配...")
                        # 尝试插入一个测试向量来验证维度
                        try:
                            test_vector = [0.0] * dimension
                            test_vector_str = "[" + ",".join(map(str, test_vector)) + "]"
                            conn.execute(f"""
                                INSERT OR REPLACE INTO vec_embeddings (article_id, embedding)
                                VALUES (-1, '{test_vector_str}')
                            """)
                            conn.execute("DELETE FROM vec_embeddings WHERE article_id = -1")
                            logger.info(f"✅ vec0表维度检查通过（维度: {dimension}）")
                        except sqlite3.OperationalError as e:
                            error_msg = str(e)
                            if "Dimension mismatch" in error_msg or "dimension" in error_msg.lower():
                                logger.warning(f"⚠️  vec0表维度不匹配！当前表维度与配置的模型维度 {dimension} 不一致。")
                                logger.warning(f"   正在删除旧表并重建...")
                                try:
                                    # 删除旧表（vec0 是虚拟表，数据在 article_embeddings 中，不会丢失）
                                    conn.execute("DROP TABLE IF EXISTS vec_embeddings")
                                    # 重建表，使用余弦距离
                                    conn.execute(f"""
                                        CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                                            article_id INTEGER PRIMARY KEY,
                                            embedding float[{dimension}] DISTANCE_METRIC=cosine
                                        )
                                    """)
                                    logger.info(f"✅ vec0表已重建（新维度: {dimension}，使用余弦距离）")
                                    logger.info("   注意：需要重新索引文章向量以同步到 vec0 表")
                                except Exception as rebuild_error:
                                    logger.error(f"❌ 重建 vec0 表失败: {rebuild_error}")
                                    logger.error(f"   请手动执行: DROP TABLE IF EXISTS vec_embeddings;")
                                    logger.error(f"   然后重启应用以自动重建表。")
                            else:
                                # 其他错误，可能是表结构问题，但不一定是维度问题
                                logger.debug(f"维度检查时出现错误（可能正常）: {e}")
                
                logger.info("✅ sqlite-vec扩展初始化成功")
            except Exception as e:
                logger.warning(f"⚠️  sqlite-vec扩展不可用，将使用Python向量计算: {e}")
            finally:
                conn.close()
                
        except Exception as e:
            logger.warning(f"⚠️  初始化sqlite-vec时出错: {e}，将使用Python向量计算")
    
    def _setup_sqlite_vec_loader(self):
        """设置 SQLAlchemy 连接事件监听器，在每次连接时加载 sqlite-vec 扩展"""
        try:
            # 检查 SQLite 版本
            sqlite_version = sqlite3.sqlite_version_info
            if sqlite_version < (3, 41, 0):
                logger.debug(f"SQLite版本 {sqlite3.sqlite_version} 过低，跳过 sqlite-vec 加载器设置")
                return
            
            # 尝试导入 sqlite_vec
            try:
                import sqlite_vec
            except ImportError:
                logger.debug("sqlite-vec模块未安装，跳过加载器设置")
                return
            
            # 注册连接事件监听器
            @event.listens_for(self.engine, "connect")
            def load_sqlite_vec(dbapi_conn, connection_record):
                """在每次创建 SQLite 连接时加载 sqlite-vec 扩展"""
                try:
                    dbapi_conn.enable_load_extension(True)
                    sqlite_vec.load(dbapi_conn)
                except Exception as e:
                    # 静默失败，因为可能某些连接不需要扩展
                    logger.debug(f"加载 sqlite-vec 扩展失败（可能不需要）: {e}")
            
            logger.info("✅ sqlite-vec 连接加载器已设置")
        except Exception as e:
            logger.debug(f"设置 sqlite-vec 加载器失败: {e}")

    @contextmanager
    def get_session(self) -> Generator[Session, None, None]:
        """获取数据库会话（上下文管理器）"""
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def drop_all(self):
        """删除所有表（谨慎使用）"""
        Base.metadata.drop_all(bind=self.engine)
        logger.warning("⚠️  所有数据库表已删除")


# 全局数据库实例
db_manager = None


def get_db() -> DatabaseManager:
    """获取数据库管理器实例"""
    global db_manager
    if db_manager is None:
        db_manager = DatabaseManager()
    return db_manager
