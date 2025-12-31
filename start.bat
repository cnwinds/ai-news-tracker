@echo off
REM AI News Tracker - 快速启动脚本

echo ========================================
echo   AI News Tracker - 快速启动
echo ========================================
echo.

REM 检查Python是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到Python，请先安装Python 3.9+
    pause
    exit /b 1
)

REM 检查是否已初始化
if not exist ".env" (
    echo [提示] 首次运行，正在初始化...
    python main.py init
    echo.
    echo [重要] 请先编辑 .env 文件，配置API密钥！
    echo.
    pause
    exit /b 0
)

REM 显示菜单
echo 请选择操作:
echo.
echo 1. 采集数据 (含AI分析)
echo 2. 查看文章列表
echo 3. 生成每日摘要
echo 4. 启动Web界面
echo 5. 启动定时任务
echo 6. 发送摘要到飞书
echo 0. 退出
echo.

set /p choice="请输入选项 (0-6): "

if "%choice%"=="1" (
    echo.
    echo [运行] python main.py collect --enable-ai
    echo.
    python main.py collect --enable-ai
) else if "%choice%"=="2" (
    echo.
    echo [运行] python main.py list
    echo.
    python main.py list --limit 30
) else if "%choice%"=="3" (
    echo.
    echo [运行] python main.py summary
    echo.
    python main.py summary
) else if "%choice%"=="4" (
    echo.
    echo [运行] python main.py web
    echo.
    python main.py web
) else if "%choice%"=="5" (
    echo.
    echo [运行] python main.py schedule
    echo.
    python main.py schedule
) else if "%choice%"=="6" (
    echo.
    echo [运行] python main.py send
    echo.
    python main.py send
) else if "%choice%"=="0" (
    exit /b 0
) else (
    echo [错误] 无效选项
)

echo.
pause
