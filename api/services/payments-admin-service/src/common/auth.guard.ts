import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaypalClient } from '../paypal/paypal.client';
import { IS_PUBLIC } from './public.decorator';
import { PayPalError } from './paypal.error';
import { AuthUser } from './auth-user';

/**
 * 全局鉴权。标了 @Public 的路由直接放行。
 * AUTH_DISABLED 时用请求头里的用户，没有头则当成管理员，方便本地联调。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly paypal: PaypalClient,
  ) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const req = context.switchToHttp().getRequest();
    req.user = this.resolve(req);
    return true;
  }

  private resolve(req: any): AuthUser {
    const config = this.paypal.config();
    const headerUserId = String(req.headers['x-user-id'] || '').trim();
    const headerRole = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    if (config.authDisabled) {
      return {
        userId: headerUserId || 'demo-user',
        isAdmin: headerRole === 'admin' || !headerUserId,
        authMode: 'disabled',
        permissions: [],
      };
    }
    if (!config.jwtSecret) throw new PayPalError('未配置 JWT_SECRET', { status: 500 });
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) throw new PayPalError('需要 Authorization: Bearer JWT', { status: 401 });
    const payload = this.verify(match[1].trim(), config.jwtSecret);
    const userId = String(payload.sub || payload.userId || payload.uid || '').trim();
    if (!userId) throw new PayPalError('JWT 缺少 sub / userId', { status: 401 });
    const role = String(payload.role || '').toLowerCase();
    const permissions = Array.isArray(payload.permissions) ? payload.permissions.map((item: unknown) => String(item)) : [];
    return { userId, isAdmin: role === 'admin' || payload.isAdmin === true, authMode: 'jwt', permissions };
  }

  private verify(token: string, secret: string) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new PayPalError('JWT 格式无效', { status: 401 });
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') throw new PayPalError('仅支持 HS256 JWT', { status: 401 });
    const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new PayPalError('JWT 签名校验失败', { status: 401 });
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Number(payload.exp) * 1000 < Date.now()) {
      throw new PayPalError('JWT 已过期', { status: 401 });
    }
    return payload;
  }
}
