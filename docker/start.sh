#!/bin/bash

# Docker 快速启动脚本

echo "=========================================="
echo "  AI News Tracker - Docker 启动脚本"
echo "=========================================="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: 未找到 Docker，请先安装 Docker"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! docker compose version &> /dev/null; then
    echo "❌ 错误: 未找到 Docker Compose，请先安装 Docker Compose"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 创建必要的目录（在 docker 目录中）
echo "📁 创建必要的目录..."
mkdir -p ./data
mkdir -p ./logs

# 使用 docker compose (Docker Compose V2)
# 指定项目名称，确保只管理自己的容器
PROJECT_NAME="ai-news-tracker"
DOCKER_COMPOSE_CMD="docker compose -p $PROJECT_NAME"

echo "📋 项目名称: $PROJECT_NAME"
echo "💡 提示: 只管理项目 '$PROJECT_NAME' 的容器，不会影响其他容器"
echo ""

# 检查是否已有容器在运行
EXISTING_CONTAINERS=$(docker ps --filter "name=ai-news-tracker" --format "{{.Names}}")
if [ -n "$EXISTING_CONTAINERS" ]; then
    echo "⚠️  检测到已有容器在运行:"
    echo "$EXISTING_CONTAINERS" | while read -r container; do
        echo "   - $container"
    done
    echo "   将使用现有容器或重新创建"
    echo ""
fi

# 构建并启动服务
echo "🔨 构建 Docker 镜像..."
$DOCKER_COMPOSE_CMD -f docker-compose.yml build

echo "🚀 启动服务..."
$DOCKER_COMPOSE_CMD -f docker-compose.yml up -d

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态（只显示本项目的容器）
echo ""
echo "📊 服务状态:"
$DOCKER_COMPOSE_CMD -f docker-compose.yml ps

echo ""
echo "✅ 服务已启动！"
echo ""
echo "🌐 访问地址:"
echo "   - 前端界面: http://localhost:5173"
echo "   - 后端API: http://localhost:8000"
echo "   - API文档: http://localhost:8000/docs"
echo ""
echo "📝 查看日志:"
echo "   $DOCKER_COMPOSE_CMD -f docker-compose.yml logs -f"
echo ""
echo "🛑 停止服务:"
echo "   $DOCKER_COMPOSE_CMD -f docker-compose.yml down"
echo ""
echo "💡 提示: 使用项目名称 '$PROJECT_NAME' 确保只管理本项目的容器"
echo ""
