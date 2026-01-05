# Docker 部署指南

本目录包含用于 Docker 容器化部署的所有配置文件。

## 📁 文件说明

- `Dockerfile.backend` - 后端服务 Docker 镜像构建文件
- `Dockerfile.frontend` - 前端服务 Docker 镜像构建文件（多阶段构建）
- `docker-compose.yml` - Docker Compose 配置文件，用于同时启动前后端服务
- `nginx.conf` - Nginx 配置文件，用于前端服务的反向代理
- `.dockerignore` - Docker 构建忽略文件

## 🚀 快速开始

### 前置要求

- 已安装 Docker 和 Docker Compose
- 确保端口 8000（后端）和 5173（前端）未被占用
- **重要**：如果在中国大陆，建议先配置 Docker 镜像加速器（见 [DOCKER_MIRROR.md](./DOCKER_MIRROR.md)），否则镜像拉取可能很慢或超时

### 启动服务

在项目根目录下执行：

```bash
# 构建并启动所有服务
docker compose -f docker/docker-compose.yml up -d --build

# 查看服务状态
docker compose -f docker/docker-compose.yml ps

# 查看日志
docker compose -f docker/docker-compose.yml logs -f
```

### 停止服务

```bash
# 停止所有服务
docker compose -f docker/docker-compose.yml down

# 停止并删除数据卷（注意：这会删除数据库）
docker compose -f docker/docker-compose.yml down -v
```

## 📂 数据持久化

数据库文件会映射到本地目录：
- 数据库文件：`../data/` → 容器内 `/app/backend/app/data/`（数据库文件存储在项目根目录的 `data` 目录中）
- 日志文件：`../logs/` → 容器内 `/app/logs/`（日志文件存储在项目根目录的 `logs` 目录中）

这样即使容器删除，数据也不会丢失。

## 🌐 访问服务

启动成功后，可以通过以下地址访问：

- **前端界面**: http://localhost:5173
- **后端API**: http://localhost:8000
- **API文档**: http://localhost:8000/docs
- **健康检查**: http://localhost:8000/health

## 🔧 配置说明

### 环境变量

可以通过修改 `docker-compose.yml` 中的 `environment` 部分来配置环境变量：

```yaml
environment:
  - DATABASE_URL=sqlite:////app/backend/app/data/ai_news.db
  - LOG_LEVEL=INFO
```

### WebSocket 配置

前端WebSocket连接通过nginx代理到后端。如果遇到WebSocket连接问题：

1. 确保nginx配置正确（`docker/nginx.conf`）
2. 检查前端环境变量 `VITE_WS_BASE_URL`（在 `Dockerfile.frontend` 中设置）
3. WebSocket URL应该使用当前页面的协议和主机，例如：`ws://localhost:5173/api/v1/ws`

### 端口配置

如果需要修改端口，可以在 `docker-compose.yml` 中修改：

```yaml
ports:
  - "自定义端口:8000"  # 后端
  - "自定义端口:80"    # 前端
```

## 🐛 常见问题

### 1. 端口被占用

如果端口被占用，可以：
- 修改 `docker-compose.yml` 中的端口映射
- 或者停止占用端口的服务

### 2. 数据库权限问题

确保本地数据库目录有正确的权限：
```bash
chmod -R 755 data
```

### 3. 前端无法连接后端

检查：
- 后端服务是否正常运行：`docker compose logs backend`
- 网络连接是否正常：`docker compose ps`
- Nginx 配置是否正确

### 4. 重新构建镜像

如果代码有更新，需要重新构建：
```bash
docker compose -f docker/docker-compose.yml up -d --build
```

## 📝 开发模式

如果需要开发模式（代码热更新），可以：

1. 使用本地开发环境（不推荐在 Docker 中开发）
2. 或者挂载代码目录到容器中（需要修改 docker-compose.yml）

## 🔍 调试

查看容器日志：
```bash
# 查看所有服务日志
docker compose -f docker/docker-compose.yml logs

# 查看特定服务日志
docker compose -f docker/docker-compose.yml logs backend
docker compose -f docker/docker-compose.yml logs frontend

# 实时查看日志
docker compose -f docker/docker-compose.yml logs -f
```

进入容器：
```bash
# 进入后端容器
docker exec -it ai-news-tracker-backend bash

# 进入前端容器
docker exec -it ai-news-tracker-frontend sh
```
