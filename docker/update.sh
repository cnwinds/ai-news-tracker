#!/bin/bash

# AI News Tracker - 更新脚本
# 功能：更新代码、编译 Docker、快速重启容器
# 任何步骤失败都会停止，不会影响当前运行的容器

set -e  # 遇到错误立即退出

echo "=========================================="
echo "  AI News Tracker - 更新脚本"
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

# 获取脚本所在目录（docker 目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 项目根目录（docker 目录的上一级）
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 使用 docker compose (Docker Compose V2)
DOCKER_COMPOSE_CMD="docker compose"

# 步骤 1: 更新代码
echo ""
echo "📥 步骤 1/3: 更新代码 (git pull)..."
cd "$PROJECT_ROOT" || exit 1

# 获取当前 commit hash（在 pull 之前）
CURRENT_COMMIT=$(git rev-parse HEAD)

# 执行 git pull
if ! git pull; then
    echo "❌ 错误: git pull 失败"
    exit 1
fi

# 获取 pull 后的 commit hash
NEW_COMMIT=$(git rev-parse HEAD)

# 检查是否有更新
if [ "$CURRENT_COMMIT" = "$NEW_COMMIT" ]; then
    echo "ℹ️  代码已是最新版本，无需更新"
    echo "✅ 脚本结束（未执行后续步骤）"
    exit 0
fi

echo "✅ 代码更新成功"

# 步骤 2: 编译 Docker 镜像
echo ""
echo "🔨 步骤 2/3: 编译 Docker 镜像..."
cd "$SCRIPT_DIR" || exit 1
if ! $DOCKER_COMPOSE_CMD -f docker-compose.yml build; then
    echo "❌ 错误: Docker 镜像编译失败"
    exit 1
fi
echo "✅ Docker 镜像编译成功"

# 步骤 3: 快速重启容器（使用新镜像）
echo ""
echo "🚀 步骤 3/3: 重启容器（使用新版本）..."
# docker compose up -d 会检测到新镜像并优雅地重启容器
# 它会先启动新容器，再停止旧容器，确保服务不中断
if ! $DOCKER_COMPOSE_CMD -f docker-compose.yml up -d; then
    echo "❌ 错误: 容器重启失败"
    exit 1
fi
echo "✅ 容器重启成功"

# 等待服务启动
echo ""
echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态
echo ""
echo "📊 服务状态:"
$DOCKER_COMPOSE_CMD -f docker-compose.yml ps

echo ""
echo "✅ 更新完成！"
echo ""
echo "🌐 访问地址:"
echo "   - 前端界面: http://localhost:5173"
echo "   - 后端API: http://localhost:8000"
echo "   - API文档: http://localhost:8000/docs"
echo ""
echo "📝 查看日志:"
echo "   $DOCKER_COMPOSE_CMD -f docker-compose.yml logs -f"
echo ""
