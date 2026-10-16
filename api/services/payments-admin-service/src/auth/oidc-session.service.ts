import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PayPalError } from '../common/paypal.error';

type PortalUser = {
  id?: string | number;
  userId?: string | number;
  username?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  platformAccess?: Record<string, string>;
  permissions?: unknown;
};

/** 用 Logto 的 access token + id token 换门户用户，再签发本服务 JWT。 */
@Injectable()
export class OidcSessionService {
  constructor(private readonly config: ConfigService) {}

  async createSession(accessToken: string, idToken: string) {
    const platformId = this.required('PLATFORM_ID');
    const secret = this.required('JWT_SECRET');
    const portalUrl = this.required('IAM_OIDC_SESSION_URL');
    const ttlSec = this.ttl();

    const portalUser = await this.fetchPortalUser(portalUrl, accessToken, idToken);
    const role = readPlatformRole(portalUser.platformAccess, platformId);
    if (role !== 'admin' && role !== 'user') {
      const detail = describePlatformAccess(portalUser);
      console.warn(`oidc session denied platform=${platformId} ${detail}`);
      throw new PayPalError(`没有 ${platformId} 的访问权限。${detail}`, { status: 403 });
    }

    const userId = String(portalUser.id ?? portalUser.userId ?? (portalUser as { uid?: string | number }).uid ?? '').trim();
    if (!userId) throw new PayPalError('门户用户缺少 id', { status: 502 });

    const permissions = permissionNames(portalUser.permissions, `${platformId}:`);
    const user = {
      id: userId,
      username: String(portalUser.username || ''),
      email: String(portalUser.email || ''),
      phone: String(portalUser.phone || ''),
      avatar: String(portalUser.avatar || ''),
      platformAccess: { [platformId]: role },
      permissions,
    };

    return {
      code: 0,
      data: {
        access_token: signJwt(
          {
            sub: userId,
            username: user.username,
            email: user.email,
            phone: user.phone,
            avatar: user.avatar,
            role,
            permissions,
            platformAccess: user.platformAccess,
          },
          secret,
          ttlSec,
        ),
        user,
      },
    };
  }

  private async fetchPortalUser(url: string, accessToken: string, idToken: string): Promise<PortalUser> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new PayPalError('无法连接登录门户', { status: 502 });
    }

    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!portalSucceeded(response.ok, body)) {
      const message = portalMessage(body, text, response.status);
      throw new PayPalError(message, { status: 401 });
    }

    const user = body?.data?.user || body?.data;
    if (!user || typeof user !== 'object' || Array.isArray(user)) {
      throw new PayPalError('门户响应缺少用户', { status: 502 });
    }
    return user as PortalUser;
  }

  private required(name: string) {
    const value = String(this.config.get(name) || '').trim();
    if (!value) throw new PayPalError(`缺少环境变量 ${name}`, { status: 500 });
    return value;
  }

  private ttl() {
    const value = Number(this.config.get('JWT_TTL_SEC') || 28800);
    return Number.isFinite(value) && value > 0 ? value : 28800;
  }
}

/** 门户成功码是 200，文案为 OK；0 也算成功。 */
function portalSucceeded(httpOk: boolean, body: any) {
  if (!httpOk) return false;
  if (!body || typeof body.code !== 'number') return true;
  return body.code === 0 || body.code === 200;
}

function readPlatformRole(access: PortalUser['platformAccess'], platformId: string) {
  const raw = access?.[platformId];
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw).trim().toLowerCase();
  }
  if (raw && typeof raw === 'object') {
    const role = (raw as { role?: unknown; access?: unknown; name?: unknown }).role
      ?? (raw as { access?: unknown }).access
      ?? (raw as { name?: unknown }).name;
    return String(role || '').trim().toLowerCase();
  }
  return '';
}

function describePlatformAccess(user: PortalUser) {
  const access = user.platformAccess;
  if (!access || typeof access !== 'object' || Array.isArray(access)) {
    const keys = Object.keys(user).filter((key) => !/token|secret|password/i.test(key));
    return `门户用户没有 platformAccess，现有字段：${keys.join('、') || '无'}`;
  }
  const parts = Object.entries(access).map(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return `${key}=${String(value).slice(0, 40)}`;
    }
    if (value && typeof value === 'object') return `${key}={${Object.keys(value as object).join(',')}}`;
    return `${key}=空`;
  });
  return `门户返回的平台权限：${parts.join('，') || '空'}`;
}

function portalMessage(body: any, text: string, status: number) {
  const candidates = [body?.message, body?.msg, body?.error, body?.data?.message, body?.data?.detail, body?.data?.error];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) return item.trim().slice(0, 200);
    if (Array.isArray(item) && item.length) return item.map((part) => String(part)).join('; ').slice(0, 200);
  }
  const snippet = text.replace(/\s+/g, ' ').trim();
  if (snippet && !snippet.startsWith('{') && !snippet.startsWith('[')) {
    return `门户拒绝登录（HTTP ${status}）：${snippet.slice(0, 160)}`;
  }
  return `门户拒绝登录（HTTP ${status}）`;
}

function permissionNames(raw: unknown, prefix: string) {
  if (!Array.isArray(raw)) return [];
  const names = raw.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object' && 'name' in item) return String((item as { name?: unknown }).name || '').trim();
    return '';
  });
  return [...new Set(names.filter((name) => name.startsWith(prefix)))];
}

function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
