# Payments · 收款账号与交易流水

跨境收款后台：集中管理收款账号、分配负责人、同步账单与争议。当前渠道为 **PayPal**，后续可扩展其它渠道。

工作台 `app_code=paypal`。登录走 Identity：**账号密码** 或 Portal **SSO ticket**（与 shop / store-design 相同模式）。本服务不签发登录 JWT，只校验 Identity JWT。

| 组件 | 端口 | 说明 |
|------|------|------|
| `web/` | **9713** | Vue 3 管理端 SPA |
| `api/services/payments-admin-service/` | **3025** | 业务 API（PayPal OAuth / 查单 / 争议） |

网关：`/api/auth/*` → auth-service；`/api/paypal/*` → payments-admin-service。

## 本地启动

```bash
# 1) API（JWT_SECRET = auth-service 的 JWT_SECRET）
cd payments/api/services/payments-admin-service
cp .env.example .env
npm run dev            # :3025

# 2) Web
cd payments/web
cp .env.example .env   # VITE_STANDALONE_AUTH=Y 可本页账号密码登录
pnpm install
pnpm dev               # :9713
```

PayPal App Return URL：`http://127.0.0.1:3025/api/callback`。

## Identity / 工作台 SSO

1. Portal：`VITE_WORKBENCH_APP_CODES` 含 `paypal`；`VITE_SUBAPP_DEPLOYMENTS.paypal.origin=http://127.0.0.1:9713`
2. auth-service：`TARGET_APPS` 含 `paypal`
3. 菜单 / 权限：`app_code=paypal`
4. 从工作台打开本应用 → `/sso?ticket=…`

## PayPal 授权方案

见 [docs/01-商家登录授权.md](docs/01-商家登录授权.md)。

## 部署（宝塔 bt-node）

密钥：`payments/bt-node.ouyiuri.com_id_ed25519`  
域名：管理端 `https://payments.ouyishop.com` · 接口 `https://payments-api.ouyishop.com`（反代本机 `:3025`）

```bash
cd payments
# Cloudflare 橙云导致 SSH 超时时报：DEPLOY_HOST=root@<源站IP>
./scripts/deploy.sh          # web + api
./scripts/deploy.sh web
./scripts/deploy.sh api
# 首次可上传本地 API .env（含密钥，慎用）
UPLOAD_ENV=1 ./scripts/deploy.sh api
```

宝塔先建好两个站点并开 SSL；脚本会写 Nginx extension 并 PM2 托管 `payments-admin-service`。
