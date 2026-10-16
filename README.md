# PayPal 多账号管理

跨境收款多账号后台：账号集中查看、负责人分配、账单/争议同步、商家登录授权（方案一）。

工作台 `app_code=paypal`。浏览器登录走 Logto，本服务再用门户会话签发自己的 JWT。

| 组件 | 端口 | 说明 |
|------|------|------|
| `web/` | **9713** | Vue 3 管理端 SPA |
| `api/services/paypal-admin-service/` | **3025** | OAuth + 多账号 API |

网关代理：`/api/paypal/*` → `paypal-admin-service`（`PAYPAL_ADMIN_SERVICE_URL`）。

## 本地启动

```bash
# 1) API
cd paypal/api/services/paypal-admin-service
cp .env.example .env   # 填入 PAYPAL_CLIENT_ID / SECRET
npm run dev            # :3025

# 2) Web
cd paypal/web
pnpm install
pnpm dev               # :9713
```

PayPal App Return URL 须为：`http://127.0.0.1:3025/api/callback`。

浏览器打开 `http://127.0.0.1:9713`，会跳到 Logto 登录。角色仍在 IAM 里分配，本服务只保存 PayPal 业务数据。

## Identity 接入

1. Migration：`EnsurePaypalSysApp1789120000000`（或执行 `identity/.../patch-add-paypal-sys-app-oy-admin.sql`）
2. Portal：`VITE_WORKBENCH_APP_CODES` 含 `paypal`；`VITE_SUBAPP_DEPLOYMENTS.paypal.origin=http://127.0.0.1:9713`
3. auth-service：`WORKBENCH_APP_CODES` 含 `paypal`；SSO `targetApp` 已支持 `paypal`
4. 用户 / 角色 / 菜单：继续用 Portal「平台管理」；本应用菜单 `app_code=paypal`，权限码如 `paypal:account:assign`

## 授权方案

商家登录授权（平台一个 REST App，商家点「使用 PayPal 登录并授权」）：见 [docs/01-商家登录授权.md](docs/01-商家登录授权.md)。
