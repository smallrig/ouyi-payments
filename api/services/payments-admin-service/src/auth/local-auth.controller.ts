import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/public.decorator';
import { PayPalError } from '../common/paypal.error';

type LoginBody = {
  username?: string;
  password?: string;
};

/**
 * 临时写死账号登录（配置 ADMIN_USERNAME / ADMIN_PASSWORD）。
 * 签发本服务 JWT，业务接口用同一 JWT_SECRET 校验。
 */
@Controller('auth')
export class LocalAuthController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginBody) {
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');
    const expectUser = String(this.config.get('ADMIN_USERNAME') || 'admin').trim();
    const expectPass = String(this.config.get('ADMIN_PASSWORD') || '');
    if (!expectPass) {
      throw new PayPalError('未配置 ADMIN_PASSWORD', { status: 500 });
    }
    if (!username || !password || !safeEqual(username, expectUser) || !safeEqual(password, expectPass)) {
      throw new PayPalError('账号或密码错误', { status: 401 });
    }

    const secret = String(this.config.get('JWT_SECRET') || '').trim();
    if (!secret) throw new PayPalError('未配置 JWT_SECRET', { status: 500 });
    const ttlSec = Number(this.config.get('JWT_TTL_SEC') || 86400 * 7);
    const now = Math.floor(Date.now() / 1000);
    const user = {
      id: 'local-admin',
      username: expectUser,
      nickname: '管理员',
      roles: ['admin'],
    };
    const token = signHs256(
      {
        uid: user.id,
        username: user.username,
        roles: user.roles,
        isAdmin: true,
        iat: now,
        exp: now + (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 86400 * 7),
      },
      secret,
    );
    return {
      code: 0,
      data: {
        token,
        access_token: token,
        user,
      },
    };
  }

  @Get('me')
  me(@Req() req: { user?: { userId: string; isAdmin: boolean; permissions: string[] } }) {
    const u = req.user;
    if (!u?.userId) throw new PayPalError('未登录', { status: 401 });
    return {
      code: 0,
      data: {
        id: u.userId,
        username: String(this.config.get('ADMIN_USERNAME') || 'admin'),
        nickname: '管理员',
        roles: u.isAdmin ? ['admin'] : ['user'],
        permissions: u.permissions || [],
      },
    };
  }
}

function signHs256(payload: Record<string, unknown>, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${h}.${p}.${sig}`;
}

function b64url(input: string) {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** timing-safe string compare for future use */
export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
