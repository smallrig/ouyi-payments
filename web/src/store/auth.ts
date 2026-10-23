import { defineStore } from 'pinia';
import { paypalFetch } from '@/api/http';

const TOKEN_KEY = 'payments.access_token';
const USER_KEY = 'payments.user';

export type LocalUser = {
  id: string;
  username: string;
  nickname?: string;
  roles?: string[];
  permissions?: string[];
};

type LoginResponse = {
  code?: number;
  data?: {
    token?: string;
    access_token?: string;
    user?: LocalUser;
  };
  token?: string;
  user?: LocalUser;
  error?: string;
};

function readUser(): LocalUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalUser;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: readUser() as LocalUser | null,
    permissions: [] as string[],
    permissionsLoaded: false,
    loginLoading: false
  }),
  getters: {
    isLogin: state => Boolean(state.token && state.user),
    displayName: state => state.user?.nickname || state.user?.username || '操作员',
    /** 始终允许本页账号密码（写死配置登录） */
    standaloneAuthEnabled: () => true
  },
  actions: {
    persist() {
      if (this.token) localStorage.setItem(TOKEN_KEY, this.token);
      else localStorage.removeItem(TOKEN_KEY);
      if (this.user) localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      else localStorage.removeItem(USER_KEY);
    },
    syncTokenFromStorage() {
      this.token = localStorage.getItem(TOKEN_KEY) || '';
      this.user = readUser();
    },
    async login(username: string, password: string) {
      this.loginLoading = true;
      try {
        const body = await paypalFetch<LoginResponse>('/auth/login', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ username, password })
        });
        const token = body.data?.token || body.data?.access_token || body.token || '';
        const user = body.data?.user || body.user;
        if (!token || !user) {
          throw new Error(body.error || '登录失败');
        }
        this.token = token;
        this.user = user;
        this.permissions = user.permissions || [];
        this.permissionsLoaded = true;
        this.persist();
      } finally {
        this.loginLoading = false;
      }
    },
    async loginByToken(token: string) {
      if (!token) return false;
      this.token = token;
      this.persist();
      try {
        await this.fetchProfile();
        return Boolean(this.user);
      } catch {
        this.token = '';
        this.user = null;
        this.persist();
        return false;
      }
    },
    async fetchProfile() {
      if (!this.token) return null;
      const body = await paypalFetch<{ code?: number; data?: LocalUser } & LocalUser>('/auth/me');
      const user = (body as { data?: LocalUser }).data || (body as LocalUser);
      if (!user?.id && !user?.username) {
        throw new Error('无效会话');
      }
      this.user = {
        id: String(user.id || 'local-admin'),
        username: String(user.username || 'admin'),
        nickname: user.nickname || '管理员',
        roles: user.roles || ['admin'],
        permissions: user.permissions || []
      };
      this.permissions = this.user.permissions || [];
      this.permissionsLoaded = true;
      this.persist();
      return this.user;
    },
    async fetchPermissions() {
      return this.permissions;
    },
    async logout() {
      this.token = '';
      this.user = null;
      this.permissions = [];
      this.permissionsLoaded = false;
      this.persist();
    },
    async exchangeSso(_ticket: string) {
      throw new Error('当前为本地账号登录，不支持 SSO ticket');
    }
  }
});
