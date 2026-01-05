#!/bin/bash

# Docker 停止脚本

echo "=========================================="
echo "  AI News Tracker - Docker 停止脚本"
echo "=========================================="

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 使用 docker compose (Docker Compose V2)
DOCKER_COMPOSE_CMD="docker compose"

# 停止服务
echo "🛑 停止服务..."
$DOCKER_COMPOSE_CMD -f docker-compose.yml down

echo "✅ 服务已停止！"
