# Studio Basil

轻量的多用户图片生成工作台。用户配置自己的 OpenAI 兼容中转站，直接完成提示词生图、参考图编辑、结果下载和会话归档。

## 功能

- 用户名和密码注册，用户数据与 API Key 隔离
- AES-256-GCM 加密保存中转站 API Key
- 自动调用 `/v1/models` 获取可用模型
- 支持 `/v1/images/generations` 与 `/v1/images/edits`
- 可选调用 `/v1/responses` 优化提示词
- 每位用户永久保存 1000 张生成图片
- 会话、生成参数、参考图上下文和结果历史
- 原图查看、下载和删除
- 默认跟随系统的明暗主题

## Docker Compose

```bash
git clone https://github.com/hbswcsyzx/studio-basil-xin.git
cd studio-basil-xin
cp .env.example .env
```

生成密钥并写入 `.env`：

```bash
openssl rand -hex 32
openssl rand -base64 32
```

第一条结果填入 `STUDIO_SECRET_KEY`，第二条填入 `STUDIO_ENCRYPTION_KEY`，然后启动：

```bash
docker compose up -d --build
```

默认入口为 `http://服务器IP:8787`。应用自身只管理 8787 端口，不管理 Caddy、Nginx 或域名。

初始管理员账号和密码均为 `admin`。首次登录会要求修改密码。

## 更新

```bash
git pull --ff-only
docker compose up -d --build
```

数据库和图片保存在 Docker 卷 `studio_data` 中，重建容器不会丢失。

## 本地验证

```bash
python -m venv .venv
.venv/bin/pip install -e '.[test]'
.venv/bin/pytest
cd frontend
corepack pnpm install
corepack pnpm test
corepack pnpm build
```

