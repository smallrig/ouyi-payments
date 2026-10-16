import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PayPalError } from '../common/paypal.error';
import { PayPalAccountEntity } from '../entities/paypal-account.entity';
import { TransactionCacheEntity } from '../entities/transaction-cache.entity';
import { TransactionEntity } from '../entities/transaction.entity';

/** 允许写入的账号状态。 */
const STATUSES = new Set(['active', 'frozen', 'pending']);

function iso(value: Date | string | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 商家账号与交易缓存的读写。对外接口不返回令牌原文。每笔交易同时写入 pp_transaction。 */
@Injectable()
export class AccountService implements OnModuleInit {
  constructor(
    @InjectRepository(PayPalAccountEntity)
    private readonly accounts: Repository<PayPalAccountEntity>,
    @InjectRepository(TransactionCacheEntity)
    private readonly caches: Repository<TransactionCacheEntity>,
    @InjectRepository(TransactionEntity)
    private readonly transactions: Repository<TransactionEntity>,
  ) {}

  /** 启动时把已有缓存拆成交易行。之后每次同步也会重写该商家的交易行。 */
  async onModuleInit() {
    const caches = await this.caches.find();
    for (const cache of caches) {
      await this.replaceTransactions(cache.payerId, Array.isArray(cache.items) ? cache.items : []);
    }
  }

  findAll() {
    return this.accounts.find({ order: { updatedAt: 'DESC' } });
  }

  findOne(payerId: string) {
    return this.accounts.findOne({ where: { payerId } });
  }

  count() {
    return this.accounts.count();
  }

  /** 按 payerId 新建或覆盖。未传的日期字段保留原值。 */
  async upsert(input: Partial<PayPalAccountEntity> & { payerId: string }) {
    if (!input.payerId) throw new PayPalError('保存账号需要 payerId', { status: 400 });
    const status = input.status || 'pending';
    if (!STATUSES.has(status)) {
      throw new PayPalError('status 只能是 active、frozen 或 pending', { status: 400 });
    }
    const existing = await this.findOne(input.payerId);
    const row = this.accounts.create({
      ...(existing || {}),
      ...input,
      payerId: input.payerId,
      status,
      lastSyncedAt: asDate(input.lastSyncedAt ?? existing?.lastSyncedAt),
      obtainedAt: asDate(input.obtainedAt ?? existing?.obtainedAt),
      refreshedAt: asDate(input.refreshedAt ?? existing?.refreshedAt),
    });
    return this.accounts.save(row);
  }

  /** 只允许改备注、负责人、状态、余额和冻结金额，不能从这里改令牌。 */
  async patch(payerId: string, patch: Record<string, unknown>) {
    const existing = await this.findOne(payerId);
    if (!existing) return null;
    const allowed = ['note', 'ownerUserId', 'ownerName', 'status', 'balance', 'frozenAmount'] as const;
    const next: Partial<PayPalAccountEntity> = {};
    for (const key of allowed) {
      if (patch[key] !== undefined) (next as any)[key] = patch[key];
    }
    return this.upsert({ ...existing, ...next, payerId });
  }

  /** 解除授权：清空令牌。原先为 active 的账号改回 pending。 */
  async clearTokens(payerId: string) {
    const existing = await this.findOne(payerId);
    if (!existing) return null;
    return this.upsert({
      ...existing,
      payerId,
      refreshToken: '',
      accessToken: '',
      expiresAt: 0,
      scope: '',
      status: existing.status === 'active' ? 'pending' : existing.status,
    });
  }

  /** 给前端的账号视图。authorized 表示还持有 refresh_token。 */
  toPublic(record: PayPalAccountEntity) {
    const expiresInSeconds = Math.max(0, Math.floor((Number(record.expiresAt) - Date.now()) / 1000));
    return {
      payerId: record.payerId,
      email: record.email || '',
      name: record.name || '',
      status: record.status || 'pending',
      balance: record.balance,
      frozenAmount: record.frozenAmount ?? 0,
      ownerUserId: record.ownerUserId || '',
      ownerName: record.ownerName || '',
      scope: record.scope || '',
      lastSyncedAt: iso(record.lastSyncedAt),
      note: record.note || '',
      obtainedAt: iso(record.obtainedAt),
      refreshedAt: iso(record.refreshedAt),
      authorized: Boolean(record.refreshToken),
      expiresAt: record.expiresAt ? new Date(Number(record.expiresAt)).toISOString() : '',
      expiresInSeconds,
      accessTokenExpired: expiresInSeconds <= 0,
    };
  }

  /** 交易列表只读 pp_transaction。缓存表只保留同步时间和查询区间。 */
  async readTransactions(payerId: string) {
    const [rows, cache] = await Promise.all([
      this.transactions.find({ where: { payerId }, order: { initiatedAt: 'DESC' } }),
      this.caches.findOne({ where: { payerId } }),
    ]);
    return {
      syncedAt: iso(cache?.syncedAt),
      range: cache?.range || {},
      items: rows.map((row) => row.raw),
    };
  }

  async writeTransactions(payerId: string, payload: { syncedAt?: string; range?: object; items?: unknown[] }) {
    const items = payload.items || [];
    await this.caches.save(
      this.caches.create({
        payerId,
        syncedAt: asDate(payload.syncedAt),
        range: payload.range || {},
        items,
      }),
    );
    await this.replaceTransactions(payerId, items);
  }

  /** 用当前流水覆盖该商家的交易行，避免重复同步产生重复记录。 */
  private async replaceTransactions(payerId: string, items: unknown[]) {
    const byId = new Map<string, TransactionEntity>();
    for (const item of items) {
      const row = this.toTransaction(payerId, item);
      if (row) byId.set(row.transactionId, row);
    }
    const rows = [...byId.values()];
    await this.transactions.delete({ payerId });
    if (rows.length) await this.transactions.save(rows);
  }

  private toTransaction(payerId: string, item: unknown) {
    const row = item as any;
    const info = row?.transaction_info || {};
    const transactionId = String(info.transaction_id || '').trim();
    if (!transactionId) return null;
    const amount = info.transaction_amount || {};
    return this.transactions.create({
      payerId,
      transactionId,
      eventCode: String(info.transaction_event_code || '').slice(0, 16),
      status: String(info.transaction_status || '').slice(0, 32),
      amountValue: Number(amount.value || 0) || 0,
      currencyCode: String(amount.currency_code || '').slice(0, 8),
      buyerEmail: String(row?.payer_info?.email_address || '').slice(0, 320),
      subject: String(info.transaction_subject || '').slice(0, 512),
      invoiceId: String(info.invoice_id || '').slice(0, 127),
      customField: String(info.custom_field || '').slice(0, 256),
      initiatedAt: asDate(info.transaction_initiation_date),
      paypalUpdatedAt: asDate(info.transaction_updated_date),
      raw: row,
    });
  }
}
