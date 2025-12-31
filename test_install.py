"""
快速测试脚本 - 验证环境和依赖
"""
import sys
from pathlib import Path


def test_python_version():
    """测试Python版本"""
    print("🔍 检查Python版本...")
    version = sys.version_info
    if version.major >= 3 and version.minor >= 9:
        print(f"  ✅ Python {version.major}.{version.minor}.{version.micro}")
        return True
    else:
        print(f"  ❌ Python版本过低: {version.major}.{version.minor}.{version.micro}")
        print(f"     需要Python 3.9+")
        return False


def test_imports():
    """测试核心包导入"""
    print("\n🔍 检查核心依赖包...")

    packages = {
        "streamlit": "Web界面",
        "sqlalchemy": "数据库",
        "feedparser": "RSS采集",
        "requests": "HTTP请求",
        "bs4": "HTML解析",
        "openai": "AI分析",
        "apscheduler": "定时任务",
        "dotenv": "配置管理",
    }

    results = {}
    for package, description in packages.items():
        try:
            if package == "bs4":
                __import__("beautifulsoup4")
            elif package == "dotenv":
                __import__("dotenv")
            else:
                __import__(package)
            print(f"  ✅ {package:15s} - {description}")
            results[package] = True
        except ImportError:
            print(f"  ❌ {package:15s} - {description} (未安装)")
            results[package] = False

    return all(results.values())


def test_directories():
    """测试目录结构"""
    print("\n🔍 检查目录结构...")

    required_dirs = ["collector", "analyzer", "database", "notification", "web", "config"]
    optional_dirs = ["data", "logs"]

    all_exist = True
    for dir_name in required_dirs:
        if Path(dir_name).exists():
            print(f"  ✅ {dir_name}/")
        else:
            print(f"  ❌ {dir_name}/ (缺失)")
            all_exist = False

    for dir_name in optional_dirs:
        if Path(dir_name).exists():
            print(f"  ✅ {dir_name}/")
        else:
            print(f"  ⚠️  {dir_name}/ (可选，将在运行时创建)")

    return all_exist


def test_config_files():
    """测试配置文件"""
    print("\n🔍 检查配置文件...")

    config_files = {
        ".env.example": "配置示例",
        "config/sources.json": "数据源配置",
        "requirements.txt": "依赖列表",
        "main.py": "主程序",
    }

    all_exist = True
    for file_name, description in config_files.items():
        if Path(file_name).exists():
            print(f"  ✅ {file_name:25s} - {description}")
        else:
            print(f"  ❌ {file_name:25s} - {description} (缺失)")
            all_exist = False

    # 检查.env
    if Path(".env").exists():
        print(f"  ✅ .env 已配置")
    else:
        print(f"  ⚠️  .env 未配置（需要从.env.example复制）")

    return all_exist


def test_database():
    """测试数据库"""
    print("\n🔍 测试数据库...")

    try:
        from database import get_db

        db = get_db()
        print("  ✅ 数据库初始化成功")
        print(f"  📄 数据库位置: {db.database_url}")
        return True
    except Exception as e:
        print(f"  ❌ 数据库初始化失败: {e}")
        return False


def main():
    """主测试函数"""
    print("=" * 60)
    print("  AI News Tracker - 环境测试")
    print("=" * 60)

    # 运行所有测试
    tests = [
        ("Python版本", test_python_version),
        ("依赖包", test_imports),
        ("目录结构", test_directories),
        ("配置文件", test_config_files),
        ("数据库", test_database),
    ]

    results = {}
    for test_name, test_func in tests:
        try:
            results[test_name] = test_func()
        except Exception as e:
            print(f"\n❌ {test_name}测试出错: {e}")
            results[test_name] = False

    # 总结
    print("\n" + "=" * 60)
    print("  测试结果总结")
    print("=" * 60)

    for test_name, passed in results.items():
        status = "✅ 通过" if passed else "❌ 失败"
        print(f"  {test_name:15s}: {status}")

    print("=" * 60)

    if all(results.values()):
        print("\n🎉 所有测试通过！系统已准备就绪。")
        print("\n下一步:")
        print("  1. 编辑 .env 文件，配置 OPENAI_API_KEY")
        print("  2. 运行: python main.py init")
        print("  3. 运行: python main.py web")
        return 0
    else:
        print("\n⚠️  部分测试失败，请根据提示修复问题。")
        print("\n常见解决方案:")
        print("  1. 依赖包缺失: 运行 install.bat 或 pip install -r requirements-minimal.txt")
        print("  2. Python版本低: 升级到Python 3.9+")
        print("  3. 配置文件: 复制 .env.example 为 .env")
        return 1


if __name__ == "__main__":
    exit_code = main()
    input("\n按Enter键退出...")
    sys.exit(exit_code)
