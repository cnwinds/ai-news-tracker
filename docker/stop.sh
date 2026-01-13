#!/bin/bash

# Docker 停止脚本

echo "=========================================="
echo "  AI News Tracker - Docker 停止脚本"
echo "=========================================="

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 使用 docker compose (Docker Compose V2)
# 指定项目名称，确保只管理自己的容器
PROJECT_NAME="ai-news-tracker"
DOCKER_COMPOSE_CMD="docker compose -p $PROJECT_NAME"

# 停止服务（只停止本项目的容器）
echo "🛑 停止服务..."
echo "📋 项目名称: $PROJECT_NAME"

# 检查是否有本项目的容器在运行
CONTAINERS=$(docker ps --filter "name=ai-news-tracker" --format "{{.Names}}")
if [ -z "$CONTAINERS" ]; then
    echo "ℹ️  没有找到运行中的容器（项目: $PROJECT_NAME）"
    # 尝试停止可能已停止的容器
    $DOCKER_COMPOSE_CMD -f docker-compose.yml down
    echo "✅ 清理完成"
else
    echo "📦 将停止以下容器:"
    echo "$CONTAINERS" | while read -r container; do
        echo "   - $container"
    done
    $DOCKER_COMPOSE_CMD -f docker-compose.yml down
fi

echo ""
echo "✅ 服务已停止！"
echo "💡 提示: 只停止了项目 '$PROJECT_NAME' 的容器，其他容器不受影响"
