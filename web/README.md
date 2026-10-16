# PayPal 多账号管理（paypal-admin-web）

ouyi-shop 工作台子应用，`VITE_APP_CODE=paypal`。Vue 3 + Vite + Naive UI。登录使用 Logto（`@logto/browser`），换发本服务 JWT 后访问 `paypal-admin-service`。

## 开发

```bash
cd paypal/web
pnpm install
pnpm dev
```

默认 **http://127.0.0.1:9713**（`vite --mode test` 读取 `.env.test`）。

### 本地联调

1. PayPal API：`VITE_PAYPAL_API_TARGET=http://127.0.0.1:3025`，前端请求 `/api/paypal/*` 重写为后端 `/api/*`
2. 启动 [paypal-admin-service](../api/services/paypal-admin-service/README.md)，配置 `FRONTEND_URL=http://127.0.0.1:9713`
3. OAuth 入口：开发代理下使用 `/api/paypal/auth/start`；或直接设置 `VITE_PAYPAL_OAUTH_START`

### 鉴权

- `VITE_LOGTO_ENDPOINT`、`VITE_LOGTO_APP_ID`、`VITE_LOGTO_API_RESOURCE`：Logto 登录
- `VITE_PLATFORM_ID=payment-accout-manage`：对应门户 `platformAccess` 的键，以及同名前缀的权限码
- `/login` 跳转 Logto，`/callback` 把 access token 和 id token 交给 `POST /api/auth/oidc/session`
- 之后业务请求携带本服务 JWT：`Authorization: Bearer`

## 构建

```bash
pnpm build
pnpm preview
```

## 页面

| 路径 | 说明 |
|------|------|
| `/` | 概览统计 |
| `/accounts` | 账号列表与授权 |
| `/accounts/:payerId` | 详情、分配、账单、订单查询 |
| `/transactions` | 跨账号交易 |
| `/disputes` | 争议 |
