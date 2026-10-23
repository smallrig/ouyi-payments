# Payments 管理端（payments-web）

ouyi-shop 工作台子应用，`VITE_APP_CODE=paypal`。Vue 3 + Vite + Naive UI。

登录：Identity **账号密码**（`VITE_STANDALONE_AUTH=Y`）或 Portal **SSO**（`/sso?ticket=`）。鉴权走 `@oy/admin-auth-sdk` → 网关 `/api/auth`。

## 本地

```bash
cd payments/web
pnpm install
pnpm dev   # http://127.0.0.1:9713
```

需配置 `.env`（参考 `.env.example`）。业务 API 默认代理 `/api/paypal` → `VITE_PAYPAL_API_TARGET`。

1. 启动 [payments-admin-service](../api/services/payments-admin-service/README.md)，`JWT_SECRET` 与 auth-service 一致
2. 确保网关 `:3020` 与 Identity Portal `:9700` 可用
3. 浏览器打开管理端登录，或从工作台 SSO 进入
