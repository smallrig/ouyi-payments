# Payments 管理 API（payments-admin-service）

NestJS 管理端后端，端口 **3025**，接口前缀 **`/api`**。收款账号、交易缓存、Webhook 与 API 日志存在 PostgreSQL（默认库名 `yxshop_paypal`）。

当前实现以 **PayPal** 渠道为主；接口按「多账号」模型组织。登录不在本服务完成，走工作台 Identity（账号密码 / Portal SSO）。

## 快速开始

```bash
cd payments/api/services/payments-admin-service
cp .env.example .env
# 填入 PAYPAL_CLIENT_ID / SECRET
# JWT_SECRET 必须与 identity auth-service 一致
# PayPal Return URL：http://127.0.0.1:3025/api/callback

npm run dev
```

健康检查：`GET http://127.0.0.1:3025/api/health`

## 鉴权

前端经网关调用 Identity `/api/auth`（登录、SSO exchange、profile）。业务请求带 `Authorization: Bearer <Identity JWT>`。

本服务用与 auth-service 相同的 `JWT_SECRET` 校验 HS256（claim：`uid`、`roles[]`）。`AUTH_DISABLED=true` 时可用 `X-User-Id` / `X-User-Role` 本地放行。

## OAuth 绑定商家（PayPal）

1. `GET /api/auth/start`（可选 `?accountId=`）
2. 登录 PayPal 沙箱商家并同意授权
3. 回调 `/api/callback` 后跳转 `FRONTEND_URL/accounts?auth=ok`

## 主要接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 列表；`?mine=1` 且非 admin 时按 `ownerUserId` 过滤 |
| GET/PATCH/DELETE | `/api/accounts/:payerId` | 详情 / 更新 / 清除 token |
| POST | `/api/accounts/:payerId/sync-transactions` | 拉取近 31 天交易 |
| GET | `/api/accounts/:payerId/transactions` | 本地缓存交易 |
| GET | `/api/stats` | 概览统计 |
| GET/POST | `/api/disputes`、`/api/disputes/sync` | 争议 |
| POST/GET | `/api/webhooks/paypal`、`/api/webhooks` | Webhook |
| GET | `/api/logs` | API 日志 |

## CORS

默认 `CORS_ORIGIN=http://127.0.0.1:9713`。
