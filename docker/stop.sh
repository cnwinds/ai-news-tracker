#!/bin/bash

# Docker 停止脚本

echo "=========================================="
echo "  AI News Tracker - Docker 停止脚本"
echo "=========================================="

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 检查是否使用 docker-compose 或 docker compose
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    DOCKER_COMPOSE_CMD="docker compose"
fi

# 停止服务
echo "🛑 停止服务..."
$DOCKER_COMPOSE_CMD -f docker-compose.yml down

echo "✅ 服务已停止！"
