"""
数据库迁移脚本：添加采集源自定义字段
添加 analysis_prompt 和 parse_fix_history 字段到 rss_sources 表
"""
import sqlite3
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def migrate_database(db_path: str):
    """
    执行数据库迁移

    Args:
        db_path: 数据库文件路径
    """
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # 检查字段是否已存在
        cursor.execute("PRAGMA table_info(rss_sources)")
        columns = [column[1] for column in cursor.fetchall()]

        # 添加 analysis_prompt 字段
        if "analysis_prompt" not in columns:
            logger.info("添加 analysis_prompt 字段...")
            cursor.execute("ALTER TABLE rss_sources ADD COLUMN analysis_prompt TEXT")
            logger.info("✅ analysis_prompt 字段已添加")
        else:
            logger.info("ℹ️  analysis_prompt 字段已存在，跳过")

        # 添加 parse_fix_history 字段
        if "parse_fix_history" not in columns:
            logger.info("添加 parse_fix_history 字段...")
            cursor.execute("ALTER TABLE rss_sources ADD COLUMN parse_fix_history TEXT")
            logger.info("✅ parse_fix_history 字段已添加")
        else:
            logger.info("ℹ️  parse_fix_history 字段已存在，跳过")

        conn.commit()
        conn.close()
        logger.info("✅ 数据库迁移完成")

    except Exception as e:
        logger.error(f"❌ 数据库迁移失败: {e}")
        raise


if __name__ == "__main__":
    # 从环境变量或默认路径获取数据库路径
    import os
    from backend.app.core.paths import APP_ROOT
    
    db_path = os.getenv("DATABASE_PATH", str(APP_ROOT / "data" / "ai_news.db"))
    
    # 确保数据库文件存在
    if not Path(db_path).exists():
        logger.warning(f"⚠️  数据库文件不存在: {db_path}")
        logger.info("将在首次运行时自动创建数据库")
    else:
        migrate_database(db_path)
