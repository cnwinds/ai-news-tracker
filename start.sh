#!/bin/bash

# AI News Tracker - 同时启动前后端服务脚本

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  AI News Tracker - 启动所有服务${NC}"
echo -e "${GREEN}========================================${NC}"

# PID 文件路径
PID_DIR="$SCRIPT_DIR/.pids"
mkdir -p "$PID_DIR"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"

# 检查服务是否已在运行
if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    if ps -p "$BACKEND_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}后端服务已在运行 (PID: $BACKEND_PID)${NC}"
        echo -e "${YELLOW}如需重启，请先运行: ./stop.sh${NC}"
        exit 1
    else
        rm -f "$BACKEND_PID_FILE"
    fi
fi

if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}前端服务已在运行 (PID: $FRONTEND_PID)${NC}"
        echo -e "${YELLOW}如需重启，请先运行: ./stop.sh${NC}"
        exit 1
    else
        rm -f "$FRONTEND_PID_FILE"
    fi
fi

# 启动后端服务
echo -e "${BLUE}正在启动后端服务...${NC}"
if [ -d "venv" ] || [ -d ".venv" ]; then
    VENV_DIR="venv"
    if [ ! -d "venv" ]; then
        VENV_DIR=".venv"
    fi
    source "$VENV_DIR/bin/activate"
fi

# 创建必要的目录
mkdir -p backend/app/data
mkdir -p logs

# 设置环境变量
export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"

# 在后台启动后端
nohup python3 -m uvicorn backend.app.main:app \
    --reload \
    --host 0.0.0.0 \
    --port 8000 \
    --log-level info \
    > logs/backend.log 2>&1 &

BACKEND_PID=$!
echo "$BACKEND_PID" > "$BACKEND_PID_FILE"
echo -e "${GREEN}后端服务已启动 (PID: $BACKEND_PID)${NC}"
echo -e "${YELLOW}  - API 文档: http://localhost:8000/docs${NC}"
echo -e "${YELLOW}  - 健康检查: http://localhost:8000/health${NC}"
echo -e "${YELLOW}  - 日志文件: logs/backend.log${NC}"

# 等待后端启动
sleep 3

# 检查后端是否成功启动
if ! ps -p "$BACKEND_PID" > /dev/null 2>&1; then
    echo -e "${RED}后端服务启动失败，请查看日志: logs/backend.log${NC}"
    rm -f "$BACKEND_PID_FILE"
    exit 1
fi

# 启动前端服务
echo -e "${BLUE}正在启动前端服务...${NC}"
cd frontend || exit 1

# 检查 node_modules
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}安装前端依赖...${NC}"
    npm install
fi

# 在后台启动前端
nohup npm run dev > ../logs/frontend.log 2>&1 &

FRONTEND_PID=$!
echo "$FRONTEND_PID" > "../$FRONTEND_PID_FILE"
echo -e "${GREEN}前端服务已启动 (PID: $FRONTEND_PID)${NC}"
echo -e "${YELLOW}  - Web 界面: http://localhost:5173${NC}"
echo -e "${YELLOW}  - 日志文件: logs/frontend.log${NC}"

cd ..

# 等待前端启动
sleep 3

# 检查前端是否成功启动
if ! ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
    echo -e "${RED}前端服务启动失败，请查看日志: logs/frontend.log${NC}"
    rm -f "$FRONTEND_PID_FILE"
    exit 1
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  所有服务已成功启动！${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${YELLOW}后端 API: http://localhost:8000${NC}"
echo -e "${YELLOW}前端界面: http://localhost:5173${NC}"
echo ""
echo -e "${YELLOW}查看日志:${NC}"
echo -e "  - 后端: tail -f logs/backend.log"
echo -e "  - 前端: tail -f logs/frontend.log"
echo ""
echo -e "${YELLOW}停止服务: ./stop.sh${NC}"
