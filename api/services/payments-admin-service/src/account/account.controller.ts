import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { PayPalError } from '../common/paypal.error';
import { AuthUser } from '../common/auth-user';
import { AccountService } from './account.service';
import { PaypalClient } from '../paypal/paypal.client';
import { CartImagesService } from '../cart/cart-images.service';
import { SyncService } from '../sync/sync.service';

/** 账号列表、授权撤销、交易同步和订单查询。非管理员只能看自己负责的账号。 */
@Controller()
export class AccountController {
  constructor(
    private readonly accounts: AccountService,
    private readonly paypal: PaypalClient,
    private readonly images: CartImagesService,
    private readonly syncJobs: SyncService,
  ) {}

  private user(req: any): AuthUser {
    return req.user;
  }

  /** 读取账号并校验归属。write 为 true 时无权限的文案改成「无权操作」。 */
  private async loadOwned(payerId: string, user: AuthUser, write = false) {
    const acc = await this.accounts.findOne(payerId);
    if (!acc) throw new PayPalError('账号不存在', { status: 404 });
    if (!user.isAdmin && acc.ownerUserId && acc.ownerUserId !== user.userId) {
      throw new PayPalError(write ? '无权操作' : '无权查看该账号', { status: 403 });
    }
    return acc;
  }

  @Get('accounts')
  async list(@Req() req: any, @Query('mine') mine?: string) {
    const user = this.user(req);
    const rows = await this.accounts.findAll();
    const filtered =
      user.isAdmin && mine !== '1'
        ? rows
        : rows.filter((a) => a.ownerUserId === user.userId || (!a.ownerUserId && user.isAdmin));
    return { accounts: filtered.map((row) => this.accounts.toPublic(row)) };
  }

  @Get('accounts/:payerId')
  async detail(@Req() req: any, @Param('payerId') payerId: string) {
    const acc = await this.loadOwned(payerId, this.user(req));
    return { account: this.accounts.toPublic(acc) };
  }

  @Patch('accounts/:payerId')
  async patch(@Req() req: any, @Param('payerId') payerId: string, @Body() body: Record<string, unknown>) {
    await this.loadOwned(payerId, this.user(req), true);
    const updated = await this.accounts.patch(payerId, body || {});
    return { account: this.accounts.toPublic(updated) };
  }

  @Delete('accounts/:payerId')
  async revoke(@Req() req: any, @Param('payerId') payerId: string) {
    const user = this.user(req);
    if (!user.isAdmin) throw new PayPalError('仅管理员可撤销授权', { status: 403 });
    await this.loadOwned(payerId, user, true);
    const updated = await this.accounts.clearTokens(payerId);
    return { account: this.accounts.toPublic(updated) };
  }

  @Post('accounts/:payerId/sync-transactions')
  async sync(@Req() req: any, @Param('payerId') payerId: string, @Body() body: { days?: number }) {
    await this.loadOwned(payerId, this.user(req), true);
    return this.syncJobs.syncAccountTransactions(payerId, body?.days, 'manual');
  }

  @Get('accounts/:payerId/transactions')
  async transactions(
    @Req() req: any,
    @Param('payerId') payerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.loadOwned(payerId, this.user(req));
    return this.accounts.readTransactions(payerId, this.parseRange(from, to));
  }

  /** from、to 为 ISO 时间。结束日由前端传到当天 23:59:59.999。 */
  private parseRange(from?: string, to?: string) {
    const start = this.parseInstant(from, '开始时间');
    const end = this.parseInstant(to, '结束时间');
    if (start && end && start.getTime() > end.getTime()) {
      throw new PayPalError('开始时间不能晚于结束时间', { status: 400 });
    }
    return { from: start, to: end };
  }

  private parseInstant(value: string | undefined, label: string) {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new PayPalError(`${label}无效`, { status: 400 });
    return date;
  }

  @Get('accounts/:payerId/orders/:orderId')
  async order(@Req() req: any, @Param('payerId') payerId: string, @Param('orderId') orderId: string) {
    await this.loadOwned(payerId, this.user(req));
    const id = this.paypal.assertOrderId(orderId);
    const result = await this.paypal.fetchOrder(payerId, id);
    return { order: result.body, debugId: result.debugId };
  }

  @Post('accounts/:payerId/cart-images')
  async cartImages(
    @Req() req: any,
    @Param('payerId') payerId: string,
    @Body() body: any,
    @Headers('authorization') authorization?: string,
  ) {
    await this.loadOwned(payerId, this.user(req), true);
    return this.images.enrich({
      customField: body?.customField || body?.custom_field || '',
      invoiceId: body?.invoiceId || body?.invoice_id || '',
      items: Array.isArray(body?.items) ? body.items : [],
      lookupBase: this.paypal.config().orderLookupBase,
      authHeader: authorization || '',
    });
  }
}
