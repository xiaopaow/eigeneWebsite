# PatchReach 第一次上线手册

这份手册按实际执行顺序编写。账号注册、付款、公司认证和银行绑定必须由站点所有人完成；其余命令可以由 Codex 在取得 SSH 密钥访问后执行。

## 0. 当前阶段

在购买服务器前，先确认 GitHub 的 `v1.0.0` 版本、本地测试和 Docker 构建全部通过。正式站初次部署仍使用 PayPal Sandbox。

## 1. 需要购买或注册的服务

1. 注册 Cloudflare，开启双重验证。
2. 购买最终域名，并将 Nameserver 改为 Cloudflare 提供的地址。
3. 购买 Ubuntu 24.04 VPS：2 vCPU、4 GB RAM、40 GB 以上磁盘。
4. 准备域名业务邮箱及 SMTP。
5. 注册 Cloudflare R2，创建私有备份 Bucket 和仅限该 Bucket 的 API Token。
6. 申请公司 PayPal Business。部署期间先使用 Sandbox，审核通过后再换 Live。

不要在聊天、GitHub Issue 或截图中公开服务器密码、PayPal Secret、SMTP 密码、Tunnel Token 或 R2 Secret。

## 2. VPS 初始配置

在 Cloud 服务商控制台添加本机 SSH 公钥后连接服务器：

```bash
ssh root@SERVER_IP
```

创建部署用户并安装 Docker：

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw unattended-upgrades
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
ufw allow OpenSSH
ufw --force enable
```

另开终端确认 `ssh deploy@SERVER_IP` 成功后，才禁用 SSH 密码登录。始终保留云服务商控制台的应急入口。

## 3. 拉取项目并配置环境

```bash
sudo mkdir -p /opt/patchreach
sudo chown deploy:deploy /opt/patchreach
git clone https://github.com/xiaopaow/eigeneWebsite.git /opt/patchreach
cd /opt/patchreach
cp .env.example .env
chmod 600 .env
```

生成随机值：

```bash
openssl rand -base64 36
```

分别用于 `POSTGRES_PASSWORD`、`JWT_SECRET` 和 `ADMIN_PASSWORD`。编辑 `.env` 时至少确认：

```env
NODE_ENV=production
APP_URL=https://YOUR_DOMAIN
HTTP_BIND=127.0.0.1:8080
ADMIN_EMAIL=YOUR_ADMIN_EMAIL
INQUIRY_TO_EMAIL=sales@YOUR_DOMAIN
PAYPAL_ENV=sandbox
CHECKOUT_CURRENCY=USD
```

SMTP、Sandbox PayPal、Tunnel 和 R2 的值在对应服务创建后填写。不要执行 `git add .env`。

## 4. 配置 Cloudflare Tunnel

1. 在 Cloudflare Zero Trust 中创建 Cloudflare Tunnel。
2. 选择 Docker 连接方式，复制 Tunnel Token 到 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN`。
3. 为 Tunnel 添加 Public Hostname：
   - `YOUR_DOMAIN` -> `http://nginx:80`
   - `www.YOUR_DOMAIN` -> `http://nginx:80`
4. 在 Cloudflare Redirect Rules 中将 `www` 永久重定向到主域名。
5. 开启 Always Use HTTPS。
6. 后续通过 Cloudflare Access 保护 `/admin*`，仅允许管理员邮箱。

Tunnel 模式不需要向公网开放 80、443 或 5432。`HTTP_BIND=127.0.0.1:8080` 只用于服务器本机检查。

## 5. 启动生产容器

```bash
cd /opt/patchreach
docker compose --profile tunnel up -d --build
./scripts/healthcheck.sh
docker compose logs --tail=100
```

首次建库由应用自动完成。不要在生产站执行示例 `seed.js`，除非确定要导入演示商品。

## 6. 迁移正式商品

在本地项目导出：

```bash
sh scripts/export-catalog.sh
```

将生成的 `migration/TIMESTAMP` 安全上传到服务器，然后在空的生产商品表中导入：

```bash
sh scripts/import-catalog.sh migration/TIMESTAMP
```

该流程只迁移商品和上传图片，不迁移测试订单、询价或客户资料。

## 7. 完成上线前内容

编辑 `public/about.html`、`contact.html`、`shipping.html`、`refunds.html`、`privacy.html`、`terms.html`，替换所有 `REPLACE_BEFORE_LAUNCH` 和方括号占位内容。政策内容应由公司负责人或法律顾问确认。

同时替换首页 `sales@example.com`，填写真实公司名称、地址、支持邮箱、生产周期、配送区域、退货条件、关税责任和适用法律。

运行：

```bash
sh scripts/preflight.sh
```

只有所有检查通过后才进入公开发布阶段。

## 8. R2 自动备份

在 `.env` 中填写 R2 Account ID、Access Key、Secret 和 Bucket。手动测试：

```bash
sh scripts/backup.sh daily
```

确认 Cloudflare R2 中出现 `daily/` 文件后配置 root 的 Cron：

```cron
20 2 * * * cd /opt/patchreach && /bin/sh scripts/backup.sh daily >> /var/log/patchreach-backup.log 2>&1
40 2 * * 0 cd /opt/patchreach && /bin/sh scripts/backup.sh weekly >> /var/log/patchreach-backup.log 2>&1
0 3 1 * * cd /opt/patchreach && /bin/sh scripts/backup.sh monthly >> /var/log/patchreach-backup.log 2>&1
```

备份分层保留约 7 天、4 周和 3 个月。每季度将备份恢复到临时数据库验证一次。

## 9. Sandbox 与 Live 切换

正式域名首先完成 Sandbox 下单、返回、Capture、邮件和 Webhook 验收。通过后，在 PayPal Developer Dashboard 创建 Live Merchant App 和 Live Webhook：

```text
https://YOUR_DOMAIN/api/paypal/webhook
```

订阅付款完成、退款和争议事件，然后替换 `.env`：

```env
PAYPAL_ENV=live
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
```

重启：

```bash
docker compose --profile tunnel up -d --build
```

只为一个低价固定商品开启 Direct checkout，完成一笔真实付款和退款。确认 PayPal 商家活动、后台订单、Capture ID、邮件和 Webhook 全部一致后，再开放其他商品。

## 10. 更新与回退

每次更新前先备份：

```bash
sh scripts/backup.sh daily
git pull --ff-only
docker compose --profile tunnel up -d --build
sh scripts/healthcheck.sh
```

支付异常时先在后台关闭 Direct checkout，保留询价流程。不要把正式网站改回 Sandbox 来处理真实客户。
