@echo off
REM AI News Tracker - 简化安装脚本

echo ========================================
echo   AI News Tracker - 快速安装
echo ========================================
echo.

REM 检查Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Python
    echo 请访问 https://www.python.org/downloads/ 下载安装 Python 3.9+
    pause
    exit /b 1
)

echo [1/4] 检测到Python版本:
python --version
echo.

echo [2/4] 升级pip和wheel...
python -m pip install --upgrade pip wheel
echo.

echo [3/4] 正在安装核心依赖包...
echo 这可能需要几分钟，请耐心等待...
echo.

REM 尝试最小安装
echo 尝试最小化安装（核心功能）...
pip install streamlit sqlalchemy feedparser requests beautifulsoup4 openai apscheduler python-dotenv click --default-timeout=100

if errorlevel 1 (
    echo.
    echo [提示] 最小安装失败，尝试使用国内镜像...
    echo.
    pip install streamlit sqlalchemy feedparser requests beautifulsoup4 openai apscheduler python-dotenv click -i https://pypi.tuna.tsinghua.edu.cn/simple --default-timeout=100
)

if errorlevel 1 (
    echo.
    echo [错误] 安装失败！
    echo.
    echo 可能的原因：
    echo 1. 网络连接问题
    echo 2. Python版本过低（需要3.9+）
    echo 3. 缺少编译工具（某些Windows系统需要）
    echo.
    echo 解决方案：
    echo 1. 查看 INSTALL.md 获取详细帮助
    echo 2. 手动安装：pip install streamlit sqlalchemy feedparser requests openai
    echo 3. 使用国内镜像：pip install [包名] -i https://pypi.tuna.tsinghua.edu.cn/simple
    echo.
    pause
    exit /b 1
)

echo.
echo [完成] 核心依赖安装成功！
echo.

REM 创建目录
echo [4/4] 创建必要的目录...
if not exist "data" mkdir data
if not exist "logs" mkdir logs
echo [完成] 目录创建成功
echo.

REM 复制配置文件
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env
        echo [完成] .env 文件已创建
    )
)
echo.

REM 验证安装
echo 验证安装...
python -c "import streamlit; print('  ✓ streamlit OK')" 2>nul || echo "  ✗ streamlit 失败"
python -c "import sqlalchemy; print('  ✓ sqlalchemy OK')" 2>nul || echo "  ✗ sqlalchemy 失败"
python -c "import feedparser; print('  ✓ feedparser OK')" 2>nul || echo "  ✗ feedparser 失败"
python -c "import openai; print('  ✓ openai OK')" 2>nul || echo "  ✗ openai 失败"
python -c "import apscheduler; print('  ✓ apscheduler OK')" 2>nul || echo "  ✗ apscheduler 失败"
echo.

echo ========================================
echo   安装完成！
echo ========================================
echo.
echo 下一步操作:
echo.
echo 1. 编辑 .env 文件，配置API密钥
echo    notepad .env
echo.
echo 2. 必需配置:
echo    OPENAI_API_KEY=your-api-key
echo    OPENAI_API_BASE=https://api.openai.com/v1
echo    OPENAI_MODEL=gpt-4-turbo-preview
echo.
echo 3. 可选配置（用于飞书推送）:
echo    FEISHU_BOT_WEBHOOK=your-webhook-url
echo.
echo 4. 开始使用:
echo    python main.py init
echo    python main.py web
echo.
echo ========================================
echo.

pause
