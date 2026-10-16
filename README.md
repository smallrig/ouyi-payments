# Payments · 收款账号与交易流水

跨境收款后台：集中管理多家收款账号、分配负责人、同步账单与争议。当前已接入 **PayPal** 商家登录授权（方案一）；后续可扩展 Stripe、银行账户等其它渠道，统一查看交易流水。

工作台 `app_code=payments`（历史环境可能仍为 `paypal`，需与 Identity 对齐）。浏览器登录走 Logto，本服务再用门户会话签发自己的 JWT。

| 组件 | 端口 | 说明 |
|------|------|------|
| `web/` | **9713** | Vue 3 管理端 SPA |
| `api/services/payments-admin-service/` | **3025** | 多账号 API；PayPal OAuth / 查单 / 争议 |

网关代理：`/api/paypal/*` 或 `/api/payments/*` → `payments-admin-service`（`PAYMENTS_ADMIN_SERVICE_URL` / 兼容 `PAYPAL_ADMIN_SERVICE_URL`）。

## 本地启动

```bash
# 1) API
cd payments/api/services/payments-admin-service
cp .env.example .env   # 填入 PAYPAL_CLIENT_ID / SECRET（PayPal 渠道）
npm run dev            # :3025

# 2) Web
cd payments/web
pnpm install
pnpm dev               # :9713
```

PayPal App Return URL 须为：`http://127.0.0.1:3025/api/callback`。

浏览器打开 `http://127.0.0.1:9713`，会跳到 Logto 登录。角色仍在 IAM 里分配，本服务只保存收款业务数据。

## Identity 接入

1. Migration：工作台应用 `payments`（历史补丁可能仍写 `paypal`）
2. Portal：`VITE_WORKBENCH_APP_CODES` 含 `payments`；`VITE_SUBAPP_DEPLOYMENTS.payments.origin=http://127.0.0.1:9713`
3. auth-service：`WORKBENCH_APP_CODES` 含 `payments`；SSO `targetApp` 支持 `payments`
4. 用户 / 角色 / 菜单：Portal「平台管理」；本应用菜单 `app_code=payments`，权限码如 `payments:account:assign`

## 渠道与授权

- **PayPal**（已实现）：商家登录授权，见 [docs/01-商家登录授权.md](docs/01-商家登录授权.md)
- 其它收款渠道：按同一「账号 → 授权/凭证 → 同步流水/争议」模型扩展
