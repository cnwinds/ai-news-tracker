@echo off
REM 简化的Web启动脚本 - 自动处理API配置

echo ========================================
echo   AI News Tracker - Web界面启动
echo ========================================
echo.

REM 检查.env文件
if not exist ".env" (
    echo [提示] .env 文件不存在，从示例复制...
    copy .env.example .env
    echo.
    echo [重要] 请根据需要编辑 .env 文件配置API密钥
    echo         如果只想测试界面，可以暂时不配置
    echo.
)

echo [提示] 正在检查OpenAI库...
pip show openai >nul 2>&1
if errorlevel 1 (
    echo [警告] openai 包未安装，正在安装...
    pip install openai
) else (
    echo [OK] openai 包已安装
)

echo.
echo [提示] 启动Web界面...
echo.
echo ========================================
echo.
echo 如果遇到 "proxies" 错误：
echo 1. 编辑 .env 文件
echo 2. 临时注释掉 OPENAI_API_KEY 那一行
echo 3. 重新运行此脚本
echo.
echo 或者查看 OPENAI_FIX.md 获取更多解决方案
echo.
echo ========================================
echo.

REM 启动Web界面
python main.py web

pause
