import { ref } from 'vue';
import { fetchAccounts } from '@/api/paypal';

export type OAuthSuccessInfo = {
  email: string;
  payerId: string;
  status: string;
  name: string;
};

/** PayPal OAuth 授权入口（浏览器整页跳转，需携带 Cookie session） */
export function getPayPalOAuthStartUrl(accountId?: string): string {
  const explicit = (import.meta.env.VITE_PAYPAL_OAUTH_START || '').trim();
  const pathOrUrl = explicit || '/api/auth/start';
  // 相对路径必须带 base；绝对 URL 可直接解析
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? new URL(pathOrUrl)
    : new URL(pathOrUrl, window.location.origin);
  if (accountId) url.searchParams.set('accountId', accountId);
  return url.toString();
}

/** 授权前确认弹框（权限说明） */
export const oauthConfirmVisible = ref(false);
/** 跳转过渡弹框状态 */
export const oauthRedirectVisible = ref(false);
export const oauthRedirectAccountId = ref<string | undefined>();
/** 绑定成功全局弹框 */
export const oauthSuccessVisible = ref(false);
export const oauthSuccessInfo = ref<OAuthSuccessInfo | null>(null);
export const oauthSuccessLoading = ref(false);
/** 成功弹框未关闭前，列表页先不要自己拉账号 */
export const oauthDeferListLoad = ref(false);
/** 点「完成」后通知各页刷新账号列表 */
export const oauthAccountsRefreshTick = ref(0);

let pendingAccountId: string | undefined;
let redirectTimer: ReturnType<typeof setTimeout> | null = null;
const REDIRECT_DELAY_MS = 900;

function clearRedirectTimer() {
  if (redirectTimer != null) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
}

/**
 * 发起授权：先弹出权限确认框。
 * 用户点「同意并连接」后再进入跳转过渡弹框并跳转 PayPal。
 */
export function startPayPalOAuth(accountId?: string) {
  clearRedirectTimer();
  oauthRedirectVisible.value = false;
  pendingAccountId = accountId;
  oauthRedirectAccountId.value = accountId;
  oauthConfirmVisible.value = true;
}

/** 确认框「同意并连接」→ 关闭确认，打开跳转过渡并计时跳转 */
export function confirmPayPalOAuth() {
  oauthConfirmVisible.value = false;
  const accountId = pendingAccountId;
  clearRedirectTimer();
  oauthRedirectAccountId.value = accountId;
  oauthRedirectVisible.value = true;

  let target: string;
  try {
    target = getPayPalOAuthStartUrl(accountId);
  } catch (err) {
    cancelPayPalOAuthRedirect();
    throw err instanceof Error ? err : new Error('无法构造 PayPal 授权地址');
  }

  redirectTimer = setTimeout(() => {
    redirectTimer = null;
    window.location.href = target;
  }, REDIRECT_DELAY_MS);
}

/** 关闭权限确认框（尚未开始跳转） */
export function cancelPayPalOAuthConfirm() {
  oauthConfirmVisible.value = false;
  pendingAccountId = undefined;
  oauthRedirectAccountId.value = undefined;
}

/** 取消尚未发生的跳转（过渡弹框阶段） */
export function cancelPayPalOAuthRedirect() {
  clearRedirectTimer();
  oauthRedirectVisible.value = false;
  oauthConfirmVisible.value = false;
  pendingAccountId = undefined;
  oauthRedirectAccountId.value = undefined;
}

const AUTH_QUERY_KEYS = ['auth', 'detail', 'email', 'payerId', 'name', 'status', 'profile'] as const;

export function stripOAuthQuery(query: Record<string, unknown>) {
  const next: Record<string, string | string[] | null | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if ((AUTH_QUERY_KEYS as readonly string[]).includes(key)) continue;
    if (value == null) {
      next[key] = null;
    } else if (Array.isArray(value)) {
      next[key] = value.map(item => String(item));
    } else {
      next[key] = String(value);
    }
  }
  return next;
}

/** 从回调 query 打开全局成功/失败结果。返回是否已消费 auth 参数。 */
export function consumePayPalOAuthResult(query: Record<string, unknown>) {
  const auth = String(query.auth || '');
  if (auth === 'ok') {
    oauthDeferListLoad.value = true;
    oauthSuccessInfo.value = {
      email: String(query.email || ''),
      payerId: String(query.payerId || ''),
      status: String(query.status || 'active'),
      name: String(query.name || '')
    };
    oauthSuccessVisible.value = true;
    if (!oauthSuccessInfo.value.payerId && !oauthSuccessInfo.value.email) {
      void hydrateSuccessAccount();
    }
    return { consumed: true as const, error: '' };
  }
  if (auth === 'error') {
    return { consumed: true as const, error: String(query.detail || '授权失败') };
  }
  return { consumed: false as const, error: '' };
}

async function hydrateSuccessAccount() {
  oauthSuccessLoading.value = true;
  try {
    const list = await fetchAccounts();
    const latest =
      [...list].sort(
        (a, b) =>
          new Date(b.obtainedAt || b.lastSyncedAt || 0).getTime() -
          new Date(a.obtainedAt || a.lastSyncedAt || 0).getTime()
      )[0] || null;
    if (!latest) return;
    oauthSuccessInfo.value = {
      email: latest.email,
      payerId: latest.payerId,
      status: latest.status,
      name: latest.name
    };
  } catch {
    /* 弹框仍展示，字段可能为空 */
  } finally {
    oauthSuccessLoading.value = false;
  }
}

/** 关闭成功弹框并通知刷新账号列表 */
export function completePayPalBindSuccess() {
  oauthSuccessVisible.value = false;
  oauthSuccessInfo.value = null;
  oauthSuccessLoading.value = false;
  oauthDeferListLoad.value = false;
  oauthAccountsRefreshTick.value += 1;
}
