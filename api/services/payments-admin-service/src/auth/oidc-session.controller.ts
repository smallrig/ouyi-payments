import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator';
import { PayPalError } from '../common/paypal.error';
import { OidcSessionService } from './oidc-session.service';

/** 用 Logto 的两枚 token 换本服务 JWT。角色和权限来自门户，不入库。 */
@Controller()
export class OidcSessionController {
  constructor(private readonly sessions: OidcSessionService) {}

  @Public()
  @Post('auth/oidc/session')
  create(
    @Headers('authorization') authorization = '',
    @Body() body: { idToken?: string },
  ) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization || '');
    const accessToken = match?.[1]?.trim() || '';
    const idToken = String(body?.idToken || '').trim();
    if (!accessToken || !idToken) {
      throw new PayPalError('需要 Authorization Bearer access token 和 idToken', { status: 400 });
    }
    return this.sessions.createSession(accessToken, idToken);
  }
}
