@echo off
REM AI News Tracker - 安装和验证脚本

echo ========================================
echo   AI News Tracker - 安装向导
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

echo [1/5] 检测到Python版本:
python --version
echo.

REM 安装依赖
echo [2/5] 正在安装依赖包...
pip install -r requirements.txt
if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)
echo [完成] 依赖包安装成功
echo.

REM 创建目录
echo [3/5] 创建必要的目录...
if not exist "data" mkdir data
if not exist "logs" mkdir logs
echo [完成] 目录创建成功
echo.

REM 复制配置文件
echo [4/5] 创建配置文件...
if not exist ".env" (
    copy .env.example .env
    echo [完成] .env 文件已创建
) else (
    echo [提示] .env 文件已存在
)
echo.

REM 初始化数据库
echo [5/5] 初始化数据库...
python main.py init
echo.

REM 完成提示
echo ========================================
echo   安装完成！
echo ========================================
echo.
echo 下一步操作:
echo.
echo 1. 编辑 .env 文件，配置API密钥
echo    notepad .env
echo.
echo 2. 必需配置项:
echo    - OPENAI_API_KEY=your-api-key
echo    - OPENAI_API_BASE=https://api.openai.com/v1
echo    - OPENAI_MODEL=gpt-4-turbo-preview
echo.
echo 3. 可选配置项:
echo    - FEISHU_BOT_WEBHOOK=your-webhook-url
echo.
echo 4. 开始使用:
echo    - python main.py collect --enable-ai  (采集数据)
echo    - python main.py web                  (Web界面)
echo    - python main.py schedule             (定时任务)
echo    - start.bat                           (快捷菜单)
echo.
echo ========================================
echo.

pause
