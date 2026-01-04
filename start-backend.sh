#!/bin/bash

# AI News Tracker - 后端服务启动脚本

# 获取脚本所在目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  AI News Tracker - 后端服务启动${NC}"
echo -e "${GREEN}========================================${NC}"

# 检查 Python 环境
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}错误: 未找到 python3，请先安装 Python 3.9+${NC}"
    exit 1
fi

# 检查虚拟环境
if [ -d "venv" ] || [ -d ".venv" ]; then
    VENV_DIR="venv"
    if [ ! -d "venv" ]; then
        VENV_DIR=".venv"
    fi
    echo -e "${YELLOW}激活虚拟环境: $VENV_DIR${NC}"
    source "$VENV_DIR/bin/activate"
fi

# 检查依赖是否安装
if ! python3 -c "import uvicorn" 2>/dev/null; then
    echo -e "${YELLOW}检测到缺少依赖，正在安装...${NC}"
    pip install -r requirements.txt
fi

# 创建必要的目录
mkdir -p backend/app/data
mkdir -p logs

# 设置环境变量（可选）
export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"

# 启动后端服务
echo -e "${GREEN}正在启动后端服务...${NC}"
echo -e "${YELLOW}API 文档: http://localhost:8000/docs${NC}"
echo -e "${YELLOW}健康检查: http://localhost:8000/health${NC}"
echo ""

python3 -m uvicorn backend.app.main:app \
    --reload \
    --host 0.0.0.0 \
    --port 8000 \
    --log-level info
