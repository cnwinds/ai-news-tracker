"""
迁移脚本：添加 daily_summaries 表
执行方式：python migrations/add_daily_summary_table.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import DatabaseManager
from database.models import DailySummary, Base
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def migrate():
    """创建 daily_summaries 表"""
    db = DatabaseManager()

    try:
        logger.info("开始创建 daily_summaries 表...")

        # 创建表
        DailySummary.__table__.create(db.engine, checkfirst=True)

        logger.info("✅ daily_summaries 表创建成功！")
        return True

    except Exception as e:
        logger.error(f"❌ 创建表失败: {e}")
        return False


if __name__ == "__main__":
    logger.info("🚀 开始执行数据库迁移...")
    if migrate():
        logger.info("✅ 迁移完成！")
    else:
        logger.error("❌ 迁移失败！")
