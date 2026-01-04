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

# 启动前端服务
echo -e "${GREEN}正在启动前端服务...${NC}"
echo -e "${YELLOW}Web 界面: http://localhost:5173${NC}"
echo ""

npm run dev
