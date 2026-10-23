import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Response } from 'express';
import { Public } from '../common/public.decorator';
import { PaypalClient } from '../paypal/paypal.client';
import { OauthSessionService } from './oauth-session.service';
import { PayPalError } from '../common/paypal.error';

/** 商家授权入口。state 存在数据库里，回调时核对后再换令牌。 */
@Controller()
export class OauthController {
  constructor(
    private readonly paypal: PaypalClient,
    private readonly sessions: OauthSessionService,
  ) {}

  @Public()
  @Get('auth/start')
  async start(@Req() req: any, @Res() res: Response, @Query('accountId') accountId = '') {
    this.paypal.assertCredentials();
    const current = await this.sessions.read(req.headers.cookie || '');
    const started = current ? { session: current, cookie: '' } : await this.sessions.start();
    if (started.cookie) res.setHeader('Set-Cookie', started.cookie);
    started.session.oauth = {
      state: randomBytes(16).toString('hex'),
      nonce: randomBytes(16).toString('hex'),
      expiresAt: Date.now() + this.paypal.config().oauthStateTtlMs,
      linkPayerId: String(accountId || '').trim(),
    };
    started.session.expiresAt = Date.now() + this.paypal.config().oauthSessionTtlMs;
    await this.sessions.save(started.session);
    res.redirect(this.paypal.buildAuthorizeUrl(started.session.oauth.state, started.session.oauth.nonce));
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: any, @Res() res: Response, @Query() query: Record<string, string>) {
    const config = this.paypal.config();
    const fail = (detail: string) =>
      res.redirect(`${config.frontendUrl}/accounts?auth=error&detail=${encodeURIComponent(detail.slice(0, 300))}`);
    const session = await this.sessions.read(req.headers.cookie || '');
    const expected = session?.oauth;
    if (!expected || expected.state !== (query.state || '') || expected.expiresAt < Date.now()) {
      return fail('state 校验失败或授权已过期，请重新发起授权');
    }
    delete session.oauth;
    await this.sessions.save(session);
    if (query.error) return fail(query.error_description || query.error);
    if (!query.code) return fail('回调里没有 authorization code');
    try {
      const { record, profileError } = await this.paypal.exchangeAuthorizationCode(
        query.code,
        expected.linkPayerId || '',
      );
      const next = new URL(`${config.frontendUrl}/accounts`);
      next.searchParams.set('auth', 'ok');
      if (record?.payerId) next.searchParams.set('payerId', record.payerId);
      if (record?.email) next.searchParams.set('email', record.email);
      if (record?.name) next.searchParams.set('name', record.name);
      if (record?.status) next.searchParams.set('status', record.status);
      if (profileError) next.searchParams.set('profile', profileError.slice(0, 180));
      res.redirect(next.toString());
    } catch (error) {
      const message = error instanceof PayPalError ? error.message : '兑换令牌失败';
      fail(message);
    }
  }
}
