"""
快速修复挂起的采集任务
"""
import sys
import os
from pathlib import Path

# 设置UTF-8编码（Windows兼容）
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 添加项目根目录到路径
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from datetime import datetime, timedelta
from backend.app.db import get_db
from backend.app.db.models import CollectionTask

def recover_stuck_tasks():
    """恢复所有挂起的采集任务"""
    db = get_db()
    
    with db.get_session() as session:
        # 查找所有running状态的任务
        running_tasks = session.query(CollectionTask).filter(
            CollectionTask.status == "running"
        ).all()
        
        if not running_tasks:
            print("[OK] 没有发现挂起的任务")
            return
        
        print(f"[INFO] 找到 {len(running_tasks)} 个running状态的任务:")
        
        current_time = datetime.now()
        timeout_threshold = timedelta(hours=1)
        recovered_count = 0
        
        for task in running_tasks:
            running_time = current_time - task.started_at
            hours = running_time.total_seconds() / 3600
            
            print(f"  - 任务 ID: {task.id}")
            print(f"    开始时间: {task.started_at}")
            print(f"    运行时间: {hours:.2f} 小时")
            
            if running_time > timeout_threshold:
                # 恢复这个任务
                task.status = "error"
                task.error_message = f"手动恢复：任务超时中断（运行时间超过{timeout_threshold.total_seconds()/3600:.1f}小时）"
                task.completed_at = current_time
                recovered_count += 1
                print(f"    [OK] 已标记为error状态")
            else:
                print(f"    [INFO] 任务运行时间未超过1小时，可能是正常运行的")
        
        if recovered_count > 0:
            session.commit()
            print(f"\n[OK] 已恢复 {recovered_count} 个挂起的任务")
        else:
            print(f"\n[INFO] 没有需要恢复的任务（所有任务都在1小时内）")

if __name__ == "__main__":
    try:
        recover_stuck_tasks()
    except Exception as e:
        print(f"[ERROR] 修复失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

