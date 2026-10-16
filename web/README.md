# Payments 管理端（payments-web）

ouyi-shop 工作台子应用，`VITE_APP_CODE=payments`。Vue 3 + Vite + Naive UI。登录使用 Logto（`@logto/browser`），换发本服务 JWT 后访问 `payments-admin-service`。

当前渠道以 PayPal 为主，产品定位为多收款账号与交易流水管理。

## 本地

```bash
cd payments/web
pnpm install
pnpm dev   # http://127.0.0.1:9713
```

需配置 `.env`（可参考 `.env.example`）。API 指向 `VITE_PAYPAL_API_TARGET`（默认 `http://127.0.0.1:3025`）。

1. 启动 [payments-admin-service](../api/services/payments-admin-service/README.md)，配置 `FRONTEND_URL=http://127.0.0.1:9713`
2. 浏览器打开管理端，经 Logto 登录后绑定收款账号
