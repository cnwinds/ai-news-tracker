#!/bin/bash

# Docker 镜像加速器配置脚本

echo "=========================================="
echo "  Docker 镜像加速器配置脚本"
echo "=========================================="

# 检测操作系统
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux 系统
    echo "检测到 Linux 系统"
    
    DOCKER_CONFIG_FILE="/etc/docker/daemon.json"
    
    # 检查是否已存在配置
    if [ -f "$DOCKER_CONFIG_FILE" ]; then
        echo "⚠️  检测到已存在的 Docker 配置文件: $DOCKER_CONFIG_FILE"
        echo "当前配置内容："
        cat "$DOCKER_CONFIG_FILE"
        echo ""
        read -p "是否要覆盖现有配置？(y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "已取消配置"
            exit 0
        fi
    fi
    
    # 创建配置目录
    sudo mkdir -p /etc/docker
    
    # 备份现有配置
    if [ -f "$DOCKER_CONFIG_FILE" ]; then
        sudo cp "$DOCKER_CONFIG_FILE" "${DOCKER_CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
        echo "✅ 已备份现有配置"
    fi
    
    # 写入新配置
    sudo tee "$DOCKER_CONFIG_FILE" > /dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://registry.docker-cn.com"
  ]
}
EOF
    
    echo "✅ 已配置 Docker 镜像加速器"
    echo ""
    echo "配置内容："
    cat "$DOCKER_CONFIG_FILE"
    echo ""
    
    # 重启 Docker 服务
    echo "🔄 正在重启 Docker 服务..."
    sudo systemctl daemon-reload
    sudo systemctl restart docker
    
    if [ $? -eq 0 ]; then
        echo "✅ Docker 服务已重启"
        echo ""
        echo "验证配置："
        docker info | grep -A 10 "Registry Mirrors" || echo "⚠️  无法验证，请手动运行: docker info | grep Registry"
    else
        echo "❌ Docker 服务重启失败，请手动重启"
        echo "运行: sudo systemctl restart docker"
    fi
    
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS 系统
    echo "检测到 macOS 系统"
    echo ""
    echo "请手动配置 Docker Desktop："
    echo "1. 打开 Docker Desktop"
    echo "2. 进入 Settings（设置）→ Docker Engine"
    echo "3. 在 JSON 配置中添加以下内容："
    echo ""
    cat <<'EOF'
{
  "registry-mirrors": [
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://registry.docker-cn.com"
  ]
}
EOF
    echo ""
    echo "4. 点击 'Apply & Restart' 应用并重启"
    
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows 系统
    echo "检测到 Windows 系统"
    echo ""
    echo "请手动配置 Docker Desktop："
    echo "1. 打开 Docker Desktop"
    echo "2. 进入 Settings（设置）→ Docker Engine"
    echo "3. 在 JSON 配置中添加以下内容："
    echo ""
    cat <<'EOF'
{
  "registry-mirrors": [
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://registry.docker-cn.com"
  ]
}
EOF
    echo ""
    echo "4. 点击 'Apply & Restart' 应用并重启"
else
    echo "❌ 不支持的操作系统: $OSTYPE"
    echo "请参考 DOCKER_MIRROR.md 手动配置"
    exit 1
fi

echo ""
echo "✅ 配置完成！"
echo ""
echo "测试镜像拉取："
echo "  docker pull python:3.11-slim"
