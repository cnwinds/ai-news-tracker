#!/bin/bash

# AI News Tracker - 停止所有服务脚本

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  AI News Tracker - 停止所有服务${NC}"
echo -e "${YELLOW}========================================${NC}"

# PID 文件路径
PID_DIR="$SCRIPT_DIR/.pids"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"

# 停止后端服务
if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    if ps -p "$BACKEND_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}正在停止后端服务 (PID: $BACKEND_PID)...${NC}"
        kill "$BACKEND_PID"
        sleep 2
        
        # 如果还在运行，强制杀死
        if ps -p "$BACKEND_PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}强制停止后端服务...${NC}"
            kill -9 "$BACKEND_PID"
        fi
        
        echo -e "${GREEN}后端服务已停止${NC}"
    else
        echo -e "${YELLOW}后端服务未运行${NC}"
    fi
    rm -f "$BACKEND_PID_FILE"
else
    echo -e "${YELLOW}未找到后端 PID 文件${NC}"
fi

# 停止前端服务
if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}正在停止前端服务 (PID: $FRONTEND_PID)...${NC}"
        kill "$FRONTEND_PID"
        sleep 2
        
        # 如果还在运行，强制杀死
        if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}强制停止前端服务...${NC}"
            kill -9 "$FRONTEND_PID"
        fi
        
        echo -e "${GREEN}前端服务已停止${NC}"
    else
        echo -e "${YELLOW}前端服务未运行${NC}"
    fi
    rm -f "$FRONTEND_PID_FILE"
else
    echo -e "${YELLOW}未找到前端 PID 文件${NC}"
fi

# 尝试通过端口杀死进程（备用方案）
echo -e "${YELLOW}检查并清理端口占用...${NC}"

# 检查 8000 端口（后端）
if lsof -ti:8000 > /dev/null 2>&1; then
    echo -e "${YELLOW}发现 8000 端口占用，正在清理...${NC}"
    lsof -ti:8000 | xargs kill -9 2>/dev/null
fi

# 检查 5173 端口（前端）
if lsof -ti:5173 > /dev/null 2>&1; then
    echo -e "${YELLOW}发现 5173 端口占用，正在清理...${NC}"
    lsof -ti:5173 | xargs kill -9 2>/dev/null
fi

echo ""
echo -e "${GREEN}所有服务已停止${NC}"
