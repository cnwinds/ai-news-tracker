"""
清空数据库脚本 - 删除所有数据并重新初始化
⚠️ 警告：此操作将删除所有数据，包括文章、采集日志、订阅源等
"""
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from database import get_db
from database.models import Base

def clear_database():
    """清空数据库并重新初始化"""
    print("=" * 60)
    print("⚠️  警告：此操作将删除所有数据库数据！")
    print("=" * 60)
    
    # 确认操作
    confirm = input("\n确定要清空数据库吗？(输入 'yes' 确认): ")
    if confirm.lower() != 'yes':
        print("❌ 操作已取消")
        return False
    
    print("\n🗑️  正在清空数据库...")
    
    try:
        # 获取数据库实例
        db = get_db()
        
        # 删除所有表
        print("   正在删除所有表...")
        Base.metadata.drop_all(bind=db.engine)
        print("   ✅ 所有表已删除")
        
        # 重新创建所有表
        print("   正在重新创建表结构...")
        Base.metadata.create_all(bind=db.engine)
        print("   ✅ 表结构已重新创建")
        
        print("\n✅ 数据库清空完成！")
        print("\n📊 已重新创建的表：")
        print("   - articles (文章表)")
        print("   - collection_logs (采集日志表)")
        print("   - notification_logs (推送日志表)")
        print("   - rss_sources (RSS订阅源表)")
        print("   - collection_tasks (采集任务表)")
        
        print("\n💡 下一步：")
        print("   1. 运行 'python import_rss_sources.py' 导入订阅源（如果需要）")
        print("   2. 运行 'python main.py collect --enable-ai' 开始采集数据")
        print("   3. 或通过Web界面点击「开始采集」按钮")
        
        return True
        
    except Exception as e:
        print(f"\n❌ 清空数据库失败: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = clear_database()
    sys.exit(0 if success else 1)
