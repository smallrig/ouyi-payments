# PayPal 多账号管理 API（paypal-admin-service）

NestJS 管理端后端，端口 **3025**，接口前缀 **`/api`**。账号、交易缓存、Webhook 与 API 日志存在 PostgreSQL 库 **`yxshop_paypal`**（`127.0.0.1:5432`）。

## 快速开始

```bash
cd paypal/api/services/paypal-admin-service
cp .env.example .env
# 填入 PAYPAL_CLIENT_ID、PAYPAL_CLIENT_SECRET，并在 PayPal Developer 中配置 Return URL：
# http://127.0.0.1:3025/api/callback

npm run dev
# 或 npm start
```

健康检查：`GET http://127.0.0.1:3025/api/health`

## OAuth 绑定商家

1. 浏览器或管理端打开：`GET /api/auth/start`（可选 `?accountId=` 用于关联已有 payerId）
2. 登录 PayPal 沙箱商家并同意授权
3. 回调 `/api/callback` 后跳转到 `FRONTEND_URL/accounts?auth=ok`（默认 `http://127.0.0.1:9713`）

## 鉴权

登录走 Logto。`POST /api/auth/oidc/session` 接收 `Authorization: Bearer <Logto access token>` 和 `{ "idToken" }`，原样提交 `IAM_OIDC_SESSION_URL`。门户返回的 `platformAccess[PLATFORM_ID]` 必须是 `admin` 或 `user`。当前平台 ID 是 `payment-accout-manage`，权限只保留这个前缀。成功后用 `JWT_SECRET` 签发本服务 JWT。

业务接口只认这枚 JWT。`AUTH_DISABLED=true` 时仍可用 `X-User-Id` / `X-User-Role` 本地放行。

## 主要接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 列表；`?mine=1` 且非 admin 时按 `ownerUserId` 过滤 |
| GET/PATCH/DELETE | `/api/accounts/:payerId` | 详情 / 更新 note、负责人、状态 / 清除 token |
| POST | `/api/accounts/:payerId/sync-transactions` | 拉取近 31 天交易（PayPal Transaction Search） |
| GET | `/api/accounts/:payerId/transactions` | 本地缓存交易 |
| GET | `/api/accounts/:payerId/orders/:orderId` | 查询订单 |
| POST | `/api/accounts/:payerId/cart-images` | 用 `custom_field`(orderId) 补全购物车商品图 |
| GET | `/api/stats` | 账号数、收款/提现汇总、争议数 |
| GET/POST | `/api/disputes`、`/api/disputes/sync` | 争议列表（含模拟）/ 同步占位 |
| POST/GET | `/api/webhooks/paypal`、`/api/webhooks` | 接收并记录 Webhook |
| GET | `/api/logs` | 近期 API 调用日志（不含密钥） |

## 数据

全部在 PostgreSQL 库 `yxshop_paypal`，不再读写本地 JSON：

- `pp_account` — 商家账号
- `pp_transaction` — 交易记录，一行一笔
- `pp_dispute` — 争议案件
- `pp_dispute_event` — 案件留言和证据
- `pp_webhook_event`、`pp_api_log` — Webhook 与接口日志

## CORS

默认允许来源 `CORS_ORIGIN=http://127.0.0.1:9713`，OAuth 使用 HttpOnly、`SameSite=Lax` Cookie 保存 state。
