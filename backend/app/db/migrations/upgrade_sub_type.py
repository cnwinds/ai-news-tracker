"""
升级程序：将老格式（从extra_config中提取sub_type）升级为新格式（直接使用sub_type字段）
在启动时自动执行，将数据库中所有源的sub_type从extra_config中提取并写入sub_type字段
"""
import logging
import json
from sqlalchemy import text
from typing import Optional

logger = logging.getLogger(__name__)


def extract_sub_type_from_legacy_config(source_type: str, extra_config_str: str, url: str) -> Optional[str]:
    """
    从老格式的extra_config中提取sub_type
    
    Args:
        source_type: 源类型（rss/api/web/social/email）
        extra_config_str: extra_config的JSON字符串
        url: 源URL
    
    Returns:
        sub_type字符串，如果无法确定则返回None
    """
    if not extra_config_str:
        return None
    
    try:
        extra_config = json.loads(extra_config_str) if isinstance(extra_config_str, str) else extra_config_str
        if not isinstance(extra_config, dict):
            return None
    except:
        return None
    
    url_lower = (url or "").lower()
    
    if source_type == "api":
        # API源：从collector_type或URL特征提取
        collector_type = extra_config.get("collector_type", "").lower()
        
        if collector_type:
            if collector_type in ["hf", "huggingface"]:
                return "huggingface"
            elif collector_type in ["pwc", "paperswithcode"]:
                return "paperswithcode"
            elif collector_type == "twitter":
                return "twitter"
            else:
                return collector_type
        elif "arxiv.org" in url_lower:
            return "arxiv"
        elif "huggingface.co" in url_lower:
            return "huggingface"
        elif "paperswithcode.com" in url_lower:
            return "paperswithcode"
        elif "twitter.com" in url_lower or "x.com" in url_lower:
            # Twitter/X 现在作为API源的子类型
            return "twitter"
    
    return None


def upgrade_sub_type_fields(engine):
    """
    升级所有源的sub_type字段：从extra_config中提取并写入sub_type字段
    
    这个函数会在启动时自动执行，将老格式（sub_type存储在extra_config中）升级为新格式（sub_type作为独立字段）
    
    Args:
        engine: SQLAlchemy引擎
    
    Returns:
        升级的源数量
    """
    try:
        with engine.connect() as conn:
            # 检查是否有需要升级的源（sub_type为NULL，但有extra_config）
            # 只处理API源（Twitter现在作为API源的子类型）
            check_result = conn.execute(text("""
                SELECT COUNT(*) 
                FROM rss_sources 
                WHERE sub_type IS NULL 
                AND extra_config IS NOT NULL 
                AND extra_config != ''
                AND source_type = 'api'
            """))
            need_upgrade_count = check_result.scalar()
            
            if need_upgrade_count == 0:
                logger.debug("ℹ️  没有需要升级的sub_type字段")
                return 0
            
            logger.info(f"🔄 发现 {need_upgrade_count} 个源需要升级sub_type字段，开始升级...")
            
            # 获取所有需要升级的源
            result = conn.execute(text("""
                SELECT id, source_type, url, extra_config 
                FROM rss_sources 
                WHERE sub_type IS NULL 
                AND extra_config IS NOT NULL 
                AND extra_config != ''
                AND source_type = 'api'
            """))
            sources = result.fetchall()
            
            upgraded_count = 0
            failed_count = 0
            
            for source_id, source_type, url, extra_config_str in sources:
                try:
                    sub_type = extract_sub_type_from_legacy_config(source_type, extra_config_str, url)
                    
                    if sub_type:
                        conn.execute(text("""
                            UPDATE rss_sources 
                            SET sub_type = :sub_type 
                            WHERE id = :source_id
                        """), {"sub_type": sub_type, "source_id": source_id})
                        upgraded_count += 1
                    else:
                        logger.debug(f"⚠️  源 {source_id} 无法从extra_config中提取sub_type")
                        failed_count += 1
                except Exception as e:
                    logger.warning(f"⚠️  升级源 {source_id} 失败: {e}")
                    failed_count += 1
            
            conn.commit()
            
            if upgraded_count > 0:
                logger.info(f"✅ 成功升级 {upgraded_count} 个源的sub_type字段")
            if failed_count > 0:
                logger.warning(f"⚠️  {failed_count} 个源无法升级（无法从extra_config中提取sub_type）")
            
            return upgraded_count
            
    except Exception as e:
        logger.error(f"❌ 升级sub_type字段失败: {e}")
        raise
