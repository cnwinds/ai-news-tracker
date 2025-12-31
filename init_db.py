"""
数据库初始化脚本 - 创建所有表（包括新增的CollectionTask表）
"""
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from database import get_db

def init_database():
    """初始化数据库，创建所有表"""
    print("🔧 正在初始化数据库...")

    try:
        db = get_db()

        # 重新创建所有表（会保留现有数据）
        # 注意：这只会添加新表，不会删除现有数据
        from database.models import Base
        Base.metadata.create_all(bind=db.engine)

        print("✅ 数据库初始化成功！")
        print("📊 已创建/更新的表：")
        print("   - articles (文章表)")
        print("   - collection_logs (采集日志表)")
        print("   - notification_logs (推送日志表)")
        print("   - rss_sources (RSS订阅源表)")
        print("   - collection_tasks (采集任务表) [新增]")

    except Exception as e:
        print(f"❌ 数据库初始化失败: {e}")
        import traceback
        traceback.print_exc()
        return False

    return True

if __name__ == "__main__":
    success = init_database()
    sys.exit(0 if success else 1)
