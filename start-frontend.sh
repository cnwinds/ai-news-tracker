#!/bin/bash

# AI News Tracker - 前端服务启动脚本

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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
echo -e "${GREEN}  AI News Tracker - 前端服务启动${NC}"
echo -e "${GREEN}========================================${NC}"

# 检查 Node.js 环境
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 node，请先安装 Node.js 16+${NC}"
    exit 1
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}错误: 未找到 npm，请先安装 npm${NC}"
    exit 1
fi

# 进入前端目录
cd frontend || exit 1

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}检测到缺少依赖，正在安装...${NC}"
    npm install
fi

# 获取公网IP并自动配置前端环境变量
PUBLIC_IP=$(get_public_ip)
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
    echo -e "${GREEN}已自动配置前端环境变量: ${API_URL}${NC}"
fi

# 启动前端服务
echo -e "${GREEN}正在启动前端服务...${NC}"
echo -e "${YELLOW}Web 界面: http://localhost:5173 (本地)${NC}"
echo -e "${YELLOW}Web 界面: http://${PUBLIC_IP}:5173 (公网)${NC}"
if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "localhost" ]; then
    echo -e "${GREEN}后端API地址: http://${PUBLIC_IP}:8000/api/v1 (已自动配置)${NC}"
fi
echo ""

npm run dev
