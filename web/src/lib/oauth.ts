import { ref } from 'vue';

/** PayPal OAuth 授权入口（浏览器整页跳转，需携带 Cookie session） */
export function getPayPalOAuthStartUrl(accountId?: string): string {
  const explicit = (import.meta.env.VITE_PAYPAL_OAUTH_START || '').trim();
  const base = explicit || '/api/paypal/auth/start';
  const url = new URL(base, explicit ? undefined : window.location.origin);
  if (accountId) url.searchParams.set('accountId', accountId);
  return url.toString();
}

/** 跳转过渡弹框状态 */
export const oauthRedirectVisible = ref(false);
export const oauthRedirectAccountId = ref<string | undefined>();

let redirectTimer: ReturnType<typeof setTimeout> | null = null;
const REDIRECT_DELAY_MS = 900;

function clearRedirectTimer() {
  if (redirectTimer != null) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
}

/** 展示过渡弹框，短暂停留后再跳转 PayPal 授权页 */
export function startPayPalOAuth(accountId?: string) {
  clearRedirectTimer();
  oauthRedirectAccountId.value = accountId;
  oauthRedirectVisible.value = true;

  const target = getPayPalOAuthStartUrl(accountId);
  redirectTimer = setTimeout(() => {
    redirectTimer = null;
    window.location.href = target;
  }, REDIRECT_DELAY_MS);
}

/** 取消尚未发生的跳转 */
export function cancelPayPalOAuthRedirect() {
  clearRedirectTimer();
  oauthRedirectVisible.value = false;
  oauthRedirectAccountId.value = undefined;
}
