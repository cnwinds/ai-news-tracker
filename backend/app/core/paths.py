"""
统一的路径管理模块
提供项目路径常量和路径设置功能
"""
from pathlib import Path
import sys

# 项目根目录（从当前文件位置计算）
# backend/app/core/paths.py -> backend/app/core -> backend/app -> backend -> 项目根
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
BACKEND_ROOT = PROJECT_ROOT / "backend"
APP_ROOT = BACKEND_ROOT / "app"


def setup_python_path():
    """
    确保项目根目录在 Python 路径中
    
    这个函数会检查项目根目录是否已经在 sys.path 中，
    如果不在则添加到最前面，避免重复添加。
    """
    root_str = str(PROJECT_ROOT)
    if root_str not in sys.path:
        sys.path.insert(0, root_str)


# 自动设置路径（当模块被导入时）
setup_python_path()

