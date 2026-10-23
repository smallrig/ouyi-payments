import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { LessThanOrEqual, Repository } from 'typeorm';
import { PayPalError } from '../common/paypal.error';
import { SyncLogEntity } from '../entities/sync-log.entity';
import { SyncTaskEntity } from '../entities/sync-task.entity';
import { AccountService } from '../account/account.service';
import { PaypalClient } from '../paypal/paypal.client';
import { RecordsService } from '../records/records.service';

const TYPES = new Set(['transactions', 'disputes']);
const MIN_INTERVAL = 60;
const MAX_LOGS = 500;

function iso(value: Date | string | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  private readonly flights = new Set<string>();

  constructor(
    @InjectRepository(SyncTaskEntity) private readonly tasks: Repository<SyncTaskEntity>,
    @InjectRepository(SyncLogEntity) private readonly logs: Repository<SyncLogEntity>,
    private readonly accounts: AccountService,
    private readonly paypal: PaypalClient,
    private readonly records: RecordsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  async listTasks() {
    const rows = await this.tasks.find({ order: { updatedAt: 'DESC' } });
    const accounts = await this.accounts.findAll();
    const names = new Map(accounts.map((acc) => [acc.payerId, acc.email || acc.name || acc.payerId]));
    return rows.map((row) => this.toPublicTask(row, names.get(row.payerId) || ''));
  }

  async createTask(input: Record<string, unknown>) {
    const now = new Date();
    const type = String(input.type || 'transactions').trim();
    if (!TYPES.has(type)) throw new PayPalError('type 只能是 transactions 或 disputes', { status: 400 });
    const intervalSec = this.clampInterval(input.intervalSec);
    const lookbackDays = this.clampDays(input.lookbackDays);
    const payerId = String(input.payerId || '').trim();
    if (payerId) {
      const acc = await this.accounts.findOne(payerId);
      if (!acc) throw new PayPalError('指定的商家账号不存在', { status: 400 });
    }
    const enabled = input.enabled !== false && input.enabled !== 'false';
    const row = this.tasks.create({
      id: randomBytes(12).toString('hex'),
      name: String(input.name || this.defaultName(type, payerId)).slice(0, 80),
      type,
      payerId,
      enabled,
      intervalSec,
      lookbackDays,
      status: 'idle',
      lastMessage: '',
      lastRunAt: null,
      nextRunAt: enabled ? new Date(now.getTime() + 15_000) : null,
      createdAt: now,
      updatedAt: now,
    });
    return this.toPublicTask(await this.tasks.save(row));
  }

  async patchTask(id: string, patch: Record<string, unknown>) {
    const existing = await this.tasks.findOne({ where: { id } });
    if (!existing) throw new PayPalError('任务不存在', { status: 404 });
    const next: Partial<SyncTaskEntity> = { updatedAt: new Date() };
    if (patch.name !== undefined) next.name = String(patch.name || '').slice(0, 80);
    if (patch.type !== undefined) {
      const type = String(patch.type).trim();
      if (!TYPES.has(type)) throw new PayPalError('type 只能是 transactions 或 disputes', { status: 400 });
      next.type = type;
    }
    if (patch.payerId !== undefined) {
      const payerId = String(patch.payerId || '').trim();
      if (payerId) {
        const acc = await this.accounts.findOne(payerId);
        if (!acc) throw new PayPalError('指定的商家账号不存在', { status: 400 });
      }
      next.payerId = payerId;
    }
    if (patch.intervalSec !== undefined) next.intervalSec = this.clampInterval(patch.intervalSec);
    if (patch.lookbackDays !== undefined) next.lookbackDays = this.clampDays(patch.lookbackDays);
    if (patch.enabled !== undefined) {
      const enabled = patch.enabled === true || patch.enabled === 'true' || patch.enabled === 1;
      next.enabled = enabled;
      next.nextRunAt = enabled ? new Date(Date.now() + 10_000) : existing.nextRunAt;
    }
    const saved = await this.tasks.save(this.tasks.create({ ...existing, ...next, id }));
    return this.toPublicTask(saved);
  }

  async deleteTask(id: string) {
    const existing = await this.tasks.findOne({ where: { id } });
    if (!existing) throw new PayPalError('任务不存在', { status: 404 });
    await this.tasks.delete({ id });
    return { ok: true };
  }

  async listLogs(query: { taskId?: string; type?: string; limit?: number }) {
    const take = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const where: Record<string, string> = {};
    if (query.taskId) where.taskId = query.taskId;
    if (query.type && TYPES.has(query.type)) where.type = query.type;
    const rows = await this.logs.find({
      where,
      order: { startedAt: 'DESC' },
      take,
    });
    return rows.map((row) => this.toPublicLog(row));
  }

  /** 手动立刻跑一次。 */
  async runTask(id: string, trigger: 'schedule' | 'manual' = 'manual') {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new PayPalError('任务不存在', { status: 404 });
    return this.execute(task, trigger);
  }

  /** 调度器：找出到期且启用的任务。 */
  async runDueTasks() {
    const now = new Date();
    const due = await this.tasks.find({
      where: { enabled: true, nextRunAt: LessThanOrEqual(now) },
      order: { nextRunAt: 'ASC' },
    });
    for (const task of due) {
      try {
        await this.execute(task, 'schedule');
      } catch (error) {
        this.logger.warn(`任务 ${task.name} 失败：${error instanceof Error ? error.message : error}`);
      }
    }
  }

  /**
   * 同步单个商家交易并写记录。账号页「同步近 31 天」也走这里。
   */
  async syncAccountTransactions(payerId: string, days?: number, trigger: 'schedule' | 'manual' = 'manual') {
    const started = Date.now();
    const startedAt = new Date();
    try {
      const { body: report, debugId, range } = await this.paypal.searchTransactions(payerId, days);
      const items = report?.transaction_details || [];
      const syncedAt = new Date().toISOString();
      await this.accounts.writeTransactions(payerId, { syncedAt, range, items });
      const acc = await this.accounts.findOne(payerId);
      if (acc) await this.accounts.upsert({ ...acc, payerId, lastSyncedAt: new Date(syncedAt) });
      const result = { syncedAt, count: items.length, range, debugId };
      await this.writeLog({
        taskId: '',
        type: 'transactions',
        payerId,
        triggerBy: trigger,
        status: 'success',
        count: items.length,
        message: `同步 ${items.length} 条交易`,
        startedAt,
        finishedAt: new Date(),
        ms: Date.now() - started,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步交易失败';
      await this.writeLog({
        taskId: '',
        type: 'transactions',
        payerId,
        triggerBy: trigger,
        status: 'failed',
        count: 0,
        message,
        startedAt,
        finishedAt: new Date(),
        ms: Date.now() - started,
      });
      throw error;
    }
  }

  private async execute(task: SyncTaskEntity, trigger: 'schedule' | 'manual') {
    if (this.flights.has(task.id) || task.status === 'running') {
      return { ok: false, skipped: true, message: '任务正在执行' };
    }
    this.flights.add(task.id);
    const started = Date.now();
    const startedAt = new Date();
    await this.tasks.save({
      ...task,
      status: 'running',
      lastRunAt: startedAt,
      updatedAt: startedAt,
    });
    try {
      const result =
        task.type === 'disputes' ? await this.runDisputes(task) : await this.runTransactions(task, trigger);
      const finishedAt = new Date();
      const intervalSec = this.clampInterval(task.intervalSec);
      await this.tasks.save({
        ...task,
        status: result.ok ? 'success' : 'failed',
        lastMessage: result.message,
        lastRunAt: startedAt,
        nextRunAt: new Date(finishedAt.getTime() + intervalSec * 1000),
        updatedAt: finishedAt,
      });
      await this.writeLog({
        taskId: task.id,
        type: task.type,
        payerId: task.payerId,
        triggerBy: trigger,
        status: result.ok ? 'success' : 'failed',
        count: result.count,
        message: result.message,
        startedAt,
        finishedAt,
        ms: Date.now() - started,
      });
      if (task.type === 'disputes') {
        this.records.lastAutoSync = {
          at: finishedAt.toISOString(),
          ok: result.ok,
          message: result.message,
        };
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步失败';
      const finishedAt = new Date();
      await this.tasks.save({
        ...task,
        status: 'failed',
        lastMessage: message,
        lastRunAt: startedAt,
        nextRunAt: new Date(finishedAt.getTime() + this.clampInterval(task.intervalSec) * 1000),
        updatedAt: finishedAt,
      });
      await this.writeLog({
        taskId: task.id,
        type: task.type,
        payerId: task.payerId,
        triggerBy: trigger,
        status: 'failed',
        count: 0,
        message,
        startedAt,
        finishedAt,
        ms: Date.now() - started,
      });
      throw error instanceof PayPalError ? error : new PayPalError(message, { status: 502 });
    } finally {
      this.flights.delete(task.id);
    }
  }

  private async runTransactions(task: SyncTaskEntity, trigger: 'schedule' | 'manual') {
    const targets = await this.resolveAccounts(task.payerId);
    if (!targets.length) return { ok: true, count: 0, message: '没有已授权账号，跳过交易同步' };
    let count = 0;
    const errors: string[] = [];
    for (const payerId of targets) {
      try {
        const result = await this.syncOneAccount(payerId, task.lookbackDays);
        count += result.count;
      } catch (error) {
        errors.push(`${payerId}: ${error instanceof Error ? error.message : '失败'}`);
        await this.writeLog({
          taskId: task.id,
          type: 'transactions',
          payerId,
          triggerBy: trigger,
          status: 'failed',
          count: 0,
          message: error instanceof Error ? error.message : '同步失败',
          startedAt: new Date(),
          finishedAt: new Date(),
          ms: 0,
        });
      }
    }
    const message = !errors.length
      ? `已同步 ${targets.length} 个账号、${count} 条交易`
      : count
        ? `已同步 ${count} 条，${errors.length} 个账号失败：${errors.slice(0, 3).join('；')}`
        : errors.slice(0, 3).join('；');
    return { ok: errors.length === 0, count, message };
  }

  private async syncOneAccount(payerId: string, days?: number) {
    const { body: report, range } = await this.paypal.searchTransactions(payerId, days);
    const items = report?.transaction_details || [];
    const syncedAt = new Date().toISOString();
    await this.accounts.writeTransactions(payerId, { syncedAt, range, items });
    const acc = await this.accounts.findOne(payerId);
    if (acc) await this.accounts.upsert({ ...acc, payerId, lastSyncedAt: new Date(syncedAt) });
    return { count: items.length, syncedAt };
  }

  private async runDisputes(task: SyncTaskEntity) {
    if (task.payerId) {
      return this.records.syncDisputesForPayer(task.payerId);
    }
    const result = await this.records.syncDisputes({ allowEmpty: true });
    return { ok: result.ok, count: result.count, message: result.message };
  }

  private async resolveAccounts(payerId: string) {
    if (payerId) {
      const acc = await this.accounts.findOne(payerId);
      return acc?.refreshToken ? [payerId] : [];
    }
    return (await this.accounts.findAll()).filter((acc) => acc.refreshToken).map((acc) => acc.payerId);
  }

  private async ensureDefaults() {
    const count = await this.tasks.count();
    if (count) return;
    const disputeEnabled = !['0', 'false', 'no'].includes(
      String(this.config.get('DISPUTE_SYNC_ENABLED') ?? 'true').trim().toLowerCase(),
    );
    const disputeInterval = Number(this.config.get('DISPUTE_SYNC_INTERVAL_SEC') || 900);
    const txInterval = Number(this.config.get('TRANSACTION_SYNC_INTERVAL_SEC') || 900);
    await this.createTask({
      name: '全量交易流水',
      type: 'transactions',
      enabled: true,
      intervalSec: txInterval,
      lookbackDays: 31,
    });
    await this.createTask({
      name: '全量争议案件',
      type: 'disputes',
      enabled: disputeEnabled,
      intervalSec: disputeInterval,
    });
    this.logger.log('已写入默认同步任务：交易流水、争议案件');
  }

  private async writeLog(input: Omit<SyncLogEntity, 'id'>) {
    await this.logs.save(
      this.logs.create({
        ...input,
        id: randomBytes(12).toString('hex'),
        message: String(input.message || '').slice(0, 500),
      }),
    );
    await this.logs.query(
      `DELETE FROM pp_sync_log WHERE id NOT IN (SELECT id FROM pp_sync_log ORDER BY started_at DESC LIMIT ${MAX_LOGS})`,
    );
  }

  private clampInterval(value: unknown) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 900;
    return Math.max(MIN_INTERVAL, Math.min(86400, Math.round(n)));
  }

  private clampDays(value: unknown) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 31;
    return Math.max(1, Math.min(31, Math.round(n)));
  }

  private defaultName(type: string, payerId: string) {
    const label = type === 'disputes' ? '争议案件' : '交易流水';
    return payerId ? `${label} · ${payerId}` : `全量${label}`;
  }

  private toPublicTask(row: SyncTaskEntity, accountLabel = '') {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      payerId: row.payerId,
      accountLabel,
      enabled: row.enabled,
      intervalSec: row.intervalSec,
      lookbackDays: row.lookbackDays,
      status: row.status,
      lastMessage: row.lastMessage,
      lastRunAt: iso(row.lastRunAt),
      nextRunAt: iso(row.nextRunAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private toPublicLog(row: SyncLogEntity) {
    return {
      id: row.id,
      taskId: row.taskId,
      type: row.type,
      payerId: row.payerId,
      triggerBy: row.triggerBy,
      status: row.status,
      count: row.count,
      message: row.message,
      startedAt: iso(row.startedAt),
      finishedAt: iso(row.finishedAt),
      ms: row.ms,
    };
  }
}
