# Docker 镜像加速配置指南

如果遇到 Docker 镜像拉取超时的问题，可以使用以下方法配置国内镜像加速。

## 方法一：配置 Docker Daemon 镜像加速器（推荐）

这是最通用的方法，配置后所有 Docker 镜像拉取都会使用加速器。

### Linux 系统

1. 编辑或创建 `/etc/docker/daemon.json` 文件：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://registry.docker-cn.com"
  ]
}
EOF
```

2. 重启 Docker 服务：

```bash
    sudo systemctl daemon-reload
    sudo systemctl restart docker
```

3. 验证配置：

```bash
docker info | grep -A 10 "Registry Mirrors"
```

### Windows / macOS

1. 打开 Docker Desktop
2. 进入 Settings（设置）→ Docker Engine
3. 在 JSON 配置中添加：

```json
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://registry.docker-cn.com"
  ]
}
```

4. 点击 "Apply & Restart" 应用并重启

## 方法二：使用阿里云容器镜像服务（推荐国内用户）

1. 登录阿里云控制台：https://cr.console.aliyun.com/
2. 进入"容器镜像服务" → "镜像加速器"
3. 复制你的专属加速地址（格式类似：`https://xxxxx.mirror.aliyuncs.com`）
4. 按照方法一的步骤配置，将加速地址添加到 `registry-mirrors` 中

## 方法三：在 Dockerfile 中直接使用国内镜像源

当前项目的 Dockerfile 已经配置使用阿里云镜像源：

- 后端：`registry.cn-hangzhou.aliyuncs.com/acs/python:3.11-slim`
- 前端构建：`registry.cn-hangzhou.aliyuncs.com/acs/node:18-alpine`
- 前端运行：`registry.cn-hangzhou.aliyuncs.com/acs/nginx:alpine`

如果这些镜像不可用，可以修改 Dockerfile 使用其他镜像源：

### 可用的国内镜像源

- **中科大镜像**：`docker.mirrors.ustc.edu.cn`
- **网易镜像**：`hub-mirror.c.163.com`
- **百度镜像**：`mirror.baidubce.com`
- **阿里云镜像**：`registry.cn-hangzhou.aliyuncs.com`
- **腾讯云镜像**：`mirror.ccs.tencentyun.com`

### 修改示例

如果需要使用其他镜像源，可以修改 Dockerfile：

```dockerfile
# 使用中科大镜像
FROM docker.mirrors.ustc.edu.cn/library/python:3.11-slim

# 或使用腾讯云镜像
FROM ccr.ccs.tencentyun.com/library/python:3.11-slim
```

## 验证镜像加速是否生效

```bash
# 拉取一个测试镜像
docker pull python:3.11-slim

# 查看镜像信息
docker images | grep python
```

## 常见问题

### 1. 配置后仍然很慢

- 检查网络连接
- 尝试更换其他镜像源
- 检查防火墙设置

### 2. 某些镜像仍然拉取失败

- 某些官方镜像可能不在镜像源中，需要直接从 Docker Hub 拉取
- 可以尝试使用 `docker pull` 时指定镜像源

### 3. 企业内网环境

- 需要配置代理服务器
- 或使用内网私有镜像仓库
