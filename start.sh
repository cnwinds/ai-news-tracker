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

# 获取公网IP地址（用于前端配置后端API地址）
get_public_ip() {
    # 首先尝试通过API查询公网IP（最准确）
    if command -v curl &> /dev/null; then
        local api_ip=$(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || \
                      curl -s --max-time 3 https://ifconfig.me 2>/dev/null || \
                      curl -s --max-time 3 https://icanhazip.com 2>/dev/null || echo "")
        if [ -n "$api_ip" ] && [[ "$api_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "$api_ip"
            return 0
        fi
    fi
    
    # 如果API查询失败，从网络接口获取所有IP地址
    local ips=$(hostname -I 2>/dev/null || ip addr show 2>/dev/null | grep -oP 'inet \K[\d.]+' | grep -v '^127\.' | tr '\n' ' ')
    
    # 优先查找非内网IP（公网IP）
    for ip in $ips; do
        # 排除内网IP段：10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x, 169.254.x.x
        if [[ ! "$ip" =~ ^10\. ]] && \
           [[ ! "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && \
           [[ ! "$ip" =~ ^192\.168\. ]] && \
           [[ ! "$ip" =~ ^127\. ]] && \
           [[ ! "$ip" =~ ^169\.254\. ]]; then
            echo "$ip"
            return 0
        fi
    done
    
    # 如果都没有找到，返回第一个非127的IP（作为备选）
    for ip in $ips; do
        if [[ ! "$ip" =~ ^127\. ]] && [[ ! "$ip" =~ ^169\.254\. ]]; then
            echo "$ip"
            return 0
        fi
    done
    
    # 如果都没有，返回localhost
    echo "localhost"
}

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
PUBLIC_IP=$(get_public_ip)
echo "$BACKEND_PID" > "$BACKEND_PID_FILE"
echo -e "${GREEN}后端服务已启动 (PID: $BACKEND_PID)${NC}"
echo -e "${YELLOW}  - API 文档: http://localhost:8000/docs${NC}"
echo -e "${YELLOW}  - API 文档: http://${PUBLIC_IP}:8000/docs (公网)${NC}"
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

# 自动配置前端环境变量，设置后端API地址
if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "localhost" ]; then
    ENV_FILE=".env"
    API_URL="http://${PUBLIC_IP}:8000/api/v1"
    WS_URL="ws://${PUBLIC_IP}:8000/api/v1/ws"
    
    # 创建或更新 .env 文件
    if [ -f "$ENV_FILE" ]; then
        # 如果文件存在，更新相关配置
        if grep -q "VITE_API_BASE_URL" "$ENV_FILE"; then
            sed -i "s|VITE_API_BASE_URL=.*|VITE_API_BASE_URL=${API_URL}|" "$ENV_FILE"
        else
            echo "VITE_API_BASE_URL=${API_URL}" >> "$ENV_FILE"
        fi
        
        if grep -q "VITE_WS_BASE_URL" "$ENV_FILE"; then
            sed -i "s|VITE_WS_BASE_URL=.*|VITE_WS_BASE_URL=${WS_URL}|" "$ENV_FILE"
        else
            echo "VITE_WS_BASE_URL=${WS_URL}" >> "$ENV_FILE"
        fi
    else
        # 如果文件不存在，创建新文件
        echo "# 后端API地址（自动生成）" > "$ENV_FILE"
        echo "VITE_API_BASE_URL=${API_URL}" >> "$ENV_FILE"
        echo "VITE_WS_BASE_URL=${WS_URL}" >> "$ENV_FILE"
    fi
    echo -e "${YELLOW}  - 已自动配置前端环境变量: ${API_URL}${NC}"
fi

# 在后台启动前端
nohup npm run dev > ../logs/frontend.log 2>&1 &

FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$FRONTEND_PID_FILE"
echo -e "${GREEN}前端服务已启动 (PID: $FRONTEND_PID)${NC}"
echo -e "${YELLOW}  - Web 界面: http://localhost:5173 (本地)${NC}"
echo -e "${YELLOW}  - Web 界面: http://${PUBLIC_IP}:5173 (公网)${NC}"
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
echo -e "${YELLOW}后端 API:${NC}"
echo -e "  - 本地: http://localhost:8000"
echo -e "  - 公网: http://${PUBLIC_IP}:8000"
echo -e "${YELLOW}前端界面:${NC}"
echo -e "  - 本地: http://localhost:5173"
echo -e "  - 公网: http://${PUBLIC_IP}:5173"
echo ""
if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "localhost" ]; then
    echo -e "${GREEN}前端已自动配置后端API地址: http://${PUBLIC_IP}:8000/api/v1${NC}"
    echo -e "${YELLOW}  (配置文件: frontend/.env)${NC}"
else
    echo -e "${YELLOW}前端使用默认配置: http://localhost:8000/api/v1${NC}"
fi
echo ""
echo -e "${YELLOW}查看日志:${NC}"
echo -e "  - 后端: tail -f logs/backend.log"
echo -e "  - 前端: tail -f logs/frontend.log"
echo ""
echo -e "${YELLOW}停止服务: ./stop.sh${NC}"
