"""
数据库迁移脚本：添加源子类型字段
添加 sub_type 字段到 rss_sources 表，用于在源类型下进一步细分采集器类型
"""
import sqlite3
import logging
import json
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

        # 添加 sub_type 字段
        if "sub_type" not in columns:
            logger.info("添加 sub_type 字段...")
            cursor.execute("ALTER TABLE rss_sources ADD COLUMN sub_type VARCHAR(50)")
            logger.info("✅ sub_type 字段已添加")
        else:
            logger.info("ℹ️  sub_type 字段已存在，跳过")

        # 迁移现有数据：从extra_config中提取sub_type
        logger.info("开始迁移现有数据的sub_type...")
        cursor.execute("SELECT id, source_type, extra_config FROM rss_sources WHERE sub_type IS NULL")
        sources = cursor.fetchall()
        
        migrated_count = 0
        for source_id, source_type, extra_config_str in sources:
            sub_type = None
            
            if extra_config_str:
                try:
                    extra_config = json.loads(extra_config_str) if isinstance(extra_config_str, str) else extra_config_str
                    
                    if source_type == "api":
                        # API源：从collector_type或URL特征提取
                        collector_type = extra_config.get("collector_type", "").lower() if isinstance(extra_config, dict) else ""
                        url = ""  # URL需要从另一个字段获取
                        
                        # 获取URL
                        cursor.execute("SELECT url FROM rss_sources WHERE id = ?", (source_id,))
                        url_result = cursor.fetchone()
                        if url_result:
                            url = url_result[0].lower() if url_result[0] else ""
                        
                        if collector_type:
                            if collector_type in ["arxiv", "hf", "huggingface"]:
                                sub_type = "huggingface" if collector_type in ["hf", "huggingface"] else "arxiv"
                            elif collector_type in ["pwc", "paperswithcode"]:
                                sub_type = "paperswithcode"
                            else:
                                sub_type = collector_type
                        elif "arxiv.org" in url:
                            sub_type = "arxiv"
                        elif "huggingface.co" in url:
                            sub_type = "huggingface"
                        elif "paperswithcode.com" in url:
                            sub_type = "paperswithcode"
                    
                    # 注意：social类型已移除，Twitter现在作为API源的子类型
                    # Reddit和HackerNews现在作为RSS源
                    
                except Exception as e:
                    logger.warning(f"解析源 {source_id} 的extra_config失败: {e}")
            
            if sub_type:
                cursor.execute("UPDATE rss_sources SET sub_type = ? WHERE id = ?", (sub_type, source_id))
                migrated_count += 1
        
        conn.commit()
        logger.info(f"✅ 已迁移 {migrated_count} 条记录的sub_type字段")
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
