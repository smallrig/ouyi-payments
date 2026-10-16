import { defineStore } from 'pinia';
import { paypalFetch } from '@/api/http';
import { logto, logtoCallbackUrl, logtoResource } from '@/lib/logto';

const TOKEN_KEY = 'paypal.access_token';
const USER_KEY = 'paypal.user';
const REDIRECT_KEY = 'paypal.post_login_redirect';

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  phone: string;
  avatar: string;
  platformAccess: Record<string, string>;
  permissions: string[];
};

type SessionResponse = {
  code: number;
  data?: {
    access_token?: string;
    user?: SessionUser;
  };
};

function platformId() {
  return import.meta.env.VITE_PLATFORM_ID || 'paypal';
}

function readStoredUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

function tokenExpired(token: string) {
  try {
    const part = token.split('.')[1] || '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

export function takePostLoginRedirect() {
  const value = sessionStorage.getItem(REDIRECT_KEY) || '/';
  sessionStorage.removeItem(REDIRECT_KEY);
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export function rememberPostLoginRedirect(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) return;
  sessionStorage.setItem(REDIRECT_KEY, path);
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: readStoredUser() as SessionUser | null,
    lastError: ''
  }),
  getters: {
    isLogin: state => Boolean(state.token && state.user),
    displayName: state => state.user?.username || state.user?.email || '操作员',
    platformRole: state => state.user?.platformAccess?.[platformId()] || '',
    hasPlatformAccess(): boolean {
      const role = this.platformRole;
      return role === 'admin' || role === 'user';
    }
  },
  actions: {
    persist() {
      if (this.token) localStorage.setItem(TOKEN_KEY, this.token);
      else localStorage.removeItem(TOKEN_KEY);
      if (this.user) localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      else localStorage.removeItem(USER_KEY);
    },
    clearLocal() {
      this.token = '';
      this.user = null;
      this.persist();
    },
    async exchangeFromLogto() {
      this.lastError = '';
      const accessToken = await logto.getAccessToken(logtoResource);
      const idToken = await logto.getIdToken();
      if (!accessToken || !idToken) {
        this.clearLocal();
        this.lastError = '没有取到登录令牌';
        return false;
      }
      try {
        const body = await paypalFetch<SessionResponse>('/auth/oidc/session', {
          method: 'POST',
          skipAuth: true,
          headers: { Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ idToken })
        });
        const token = body.data?.access_token || '';
        const user = body.data?.user;
        const role = user?.platformAccess?.[platformId()] || '';
        if (!token || !user || (role !== 'admin' && role !== 'user')) {
          this.clearLocal();
          this.lastError = `没有 ${platformId()} 的访问权限`;
          return false;
        }
        this.token = token;
        this.user = user;
        this.persist();
        return true;
      } catch (err) {
        this.clearLocal();
        this.lastError = err instanceof Error ? err.message : '登录失败';
        return false;
      }
    },
    /** 本地 JWT 还在就直接用；丢掉用户信息但 Logto 仍登录时，重新换发。 */
    async ensureSession() {
      if (this.token && this.user && !tokenExpired(this.token) && this.hasPlatformAccess) return true;
      if (!(await logto.isAuthenticated())) {
        this.clearLocal();
        return false;
      }
      return this.exchangeFromLogto();
    },
    async signIn(redirect = '/') {
      rememberPostLoginRedirect(redirect);
      await logto.signIn(logtoCallbackUrl());
    },
    async logout() {
      this.clearLocal();
      const base = import.meta.env.VITE_BASE_URL || '/';
      const back = new URL('login', `${location.origin}${base.startsWith('/') ? base : `/${base}`}`).href;
      await logto.signOut(back);
    }
  }
});
