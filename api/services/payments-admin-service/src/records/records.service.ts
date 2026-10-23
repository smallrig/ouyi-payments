import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { ApiLogEntity } from '../entities/api-log.entity';
import { DisputeEntity } from '../entities/dispute.entity';
import { DisputeEventEntity } from '../entities/dispute-event.entity';
import { WebhookEventEntity } from '../entities/webhook-event.entity';
import { AccountService } from '../account/account.service';
import { PaypalClient } from '../paypal/paypal.client';
import { PayPalError } from '../common/paypal.error';

export type DisputeFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

/**
 * 争议、Webhook 和接口日志。
 * 争议列表来自本地表；详情和回应操作会用该商家自己的令牌再打 PayPal。
 */
@Injectable()
export class RecordsService implements OnModuleInit {
  private readonly logger = new Logger(RecordsService.name);
  lastAutoSync: { at: string; ok: boolean; message: string } | null = null;
  private autoSyncing = false;

  constructor(
    @InjectRepository(DisputeEntity) private readonly disputes: Repository<DisputeEntity>,
    @InjectRepository(DisputeEventEntity) private readonly events: Repository<DisputeEventEntity>,
    @InjectRepository(WebhookEventEntity) private readonly webhooks: Repository<WebhookEventEntity>,
    @InjectRepository(ApiLogEntity) private readonly logs: Repository<ApiLogEntity>,
    private readonly accounts: AccountService,
    private readonly paypal: PaypalClient,
  ) {}

  /** 启动时把已有案件里的留言和证据拆成事件行。 */
  async onModuleInit() {
    const rows = await this.disputes.find();
    for (const row of rows) await this.replaceEvents(row);
  }

  async listDisputes() {
    const rows = await this.disputes.find({ order: { createdAt: 'DESC' } });
    const events = rows.length
      ? await this.events.find({ where: { disputeId: In(rows.map((row) => row.id)) }, order: { occurredAt: 'ASC' } })
      : [];
    const grouped = new Map<string, DisputeEventEntity[]>();
    for (const event of events) {
      const list = grouped.get(event.disputeId) || [];
      list.push(event);
      grouped.set(event.disputeId, list);
    }
    return rows.map((row) => this.toPublic(row, grouped.get(row.id) || []));
  }

  /**
   * 遍历已授权账号，分页拉取争议摘要并写入 pp_dispute。
   * 单个账号失败不影响其他账号；全部失败时把原因抛给前端。
   */
  async syncDisputes(opts: { allowEmpty?: boolean } = {}) {
    const accounts = (await this.accounts.findAll()).filter((acc) => acc.refreshToken);
    if (!accounts.length) {
      if (opts.allowEmpty) return { ok: true, count: 0, errors: [], message: '没有已授权账号，跳过同步' };
      throw new PayPalError('没有已授权的 PayPal 账号，无法同步争议', { status: 400 });
    }
    let count = 0;
    const errors: Array<{ payerId: string; message: string }> = [];
    for (const acc of accounts) {
      try {
        const items = await this.paypal.listDisputes(acc.payerId);
        for (const item of items) {
          await this.savePaypalDispute(acc.payerId, item, false);
          count += 1;
        }
      } catch (error) {
        errors.push({
          payerId: acc.payerId,
          message: error instanceof Error ? error.message : '同步失败',
        });
      }
    }
    const unique = [...new Set(errors.map((item) => item.message))];
    const message = !errors.length
      ? `已同步 ${count} 条争议`
      : count
        ? `已同步 ${count} 条，${errors.length} 个账号失败：${unique.join('；')}`
        : unique.join('；');
    if (!count && errors.length) {
      throw new PayPalError(message, { status: 403 });
    }
    const result = { ok: errors.length === 0, count, errors, message };
    this.lastAutoSync = { at: new Date().toISOString(), ok: result.ok, message };
    return result;
  }

  /** 只同步一个商家的争议摘要。 */
  async syncDisputesForPayer(payerId: string) {
    const acc = await this.accounts.findOne(payerId);
    if (!acc?.refreshToken) {
      throw new PayPalError(`账号 ${payerId} 尚未授权`, { status: 401 });
    }
    const items = await this.paypal.listDisputes(payerId);
    for (const item of items) {
      await this.savePaypalDispute(payerId, item, false);
    }
    return { ok: true, count: items.length, message: `已同步 ${items.length} 条争议` };
  }

  /** 定时任务入口：空账号不抛错，避免刷屏。 */
  async runAutoSync() {
    if (this.autoSyncing) return this.lastAutoSync;
    this.autoSyncing = true;
    try {
      const result = await this.syncDisputes({ allowEmpty: true });
      this.logger.log(`自动同步争议：${result.message}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动同步失败';
      this.lastAutoSync = { at: new Date().toISOString(), ok: false, message };
      this.logger.warn(`自动同步争议失败：${message}`);
      return this.lastAutoSync;
    } finally {
      this.autoSyncing = false;
    }
  }

  /**
   * 用已同步的真实交易生成几条示例争议，方便把列表和详情页填满。
   * 这些案件只写在本地，不会提交到 PayPal。再次调用会按同样编号覆盖。
   */
  async seedSamples() {
    const txs = await this.sampleTransactions();
    if (!txs.length) {
      throw new PayPalError('还没有交易缓存，请先在账号里同步交易后再生成示例争议', { status: 400 });
    }
    const now = Date.now();
    const day = 86400000;
    const specs = [
      {
        status: 'WAITING_FOR_SELLER_RESPONSE',
        reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
        stage: 'INQUIRY',
        created: now - 2 * day,
        due: now + 3 * day,
        messages: [
          { by: 'BUYER', text: '包裹显示已签收，但我没有收到商品，请协助核实物流。' },
        ],
        evidences: [] as Array<{ type: string; notes: string; source: string }>,
      },
      {
        status: 'OPEN',
        reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
        stage: 'CHARGEBACK',
        created: now - 6 * day,
        due: now + 5 * day,
        messages: [
          { by: 'BUYER', text: '收到的商品颜色和尺寸与页面描述不一致，希望退货退款。' },
          { by: 'SELLER', text: '已联系买家确认尺码，正在等待退回照片。' },
        ],
        evidences: [],
      },
      {
        status: 'UNDER_REVIEW',
        reason: 'UNAUTHORISED',
        stage: 'PRE_ARBITRATION',
        created: now - 11 * day,
        due: now + 2 * day,
        messages: [
          { by: 'BUYER', text: '这笔扣款不是我本人操作的。' },
          { by: 'SELLER', text: '订单有完整的支付与发货记录，已提交物流证明。' },
        ],
        evidences: [{ type: 'PROOF_OF_FULFILLMENT', notes: '物流单号 1Z999AA10123456784，已签收', source: 'SUBMITTED_BY_SELLER' }],
      },
      {
        status: 'WAITING_FOR_BUYER_RESPONSE',
        reason: 'CREDIT_NOT_PROCESSED',
        stage: 'INQUIRY',
        created: now - 4 * day,
        due: now + 6 * day,
        messages: [
          { by: 'BUYER', text: '申请退款已经一周，信用卡还没有入账。' },
          { by: 'SELLER', text: '已提议全额退款，等待买家确认。' },
        ],
        evidences: [{ type: 'PROOF_OF_REFUND', notes: '退款已在支付渠道发起', source: 'SUBMITTED_BY_SELLER' }],
      },
      {
        status: 'RESOLVED',
        reason: 'DUPLICATE_TRANSACTION',
        stage: 'CHARGEBACK',
        created: now - 18 * day,
        due: now - 4 * day,
        messages: [
          { by: 'BUYER', text: '同一笔订单被扣了两次。' },
          { by: 'SELLER', text: '重复扣款已退回，请查收。' },
          { by: 'PAYPAL', text: '争议已解决，结果为卖家胜诉。' },
        ],
        evidences: [{ type: 'PROOF_OF_REFUND', notes: '重复扣款退款凭证', source: 'SUBMITTED_BY_SELLER' }],
      },
    ];
    const ids: string[] = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const tx = txs[index % txs.length];
      const id = `PP-D-SAMPLE-${String(index + 1).padStart(3, '0')}`;
      const createdAt = new Date(spec.created).toISOString();
      await this.savePaypalDispute(
        tx.payerId,
        {
          dispute_id: id,
          create_time: createdAt,
          update_time: createdAt,
          status: spec.status,
          reason: spec.reason,
          dispute_amount: tx.amount,
          dispute_life_cycle_stage: spec.stage,
          seller_response_due_date: new Date(spec.due).toISOString(),
          sample: true,
          disputed_transactions: [
            {
              seller_transaction_id: tx.transactionId,
              buyer_transaction_id: tx.transactionId,
              buyer: { email: tx.buyerEmail },
              items: tx.subject ? [{ item_name: tx.subject }] : [],
            },
          ],
          messages: spec.messages.map((msg, msgIndex) => ({
            posted_by: msg.by,
            time_posted: new Date(spec.created + msgIndex * 3600000).toISOString(),
            content: msg.text,
          })),
          evidences: spec.evidences.map((ev) => ({
            evidence_type: ev.type,
            notes: ev.notes,
            source: ev.source,
          })),
        },
        true,
      );
      ids.push(id);
    }
    return {
      ok: true,
      count: ids.length,
      ids,
      message: `已根据现有交易生成 ${ids.length} 条示例争议，仅用于页面展示`,
    };
  }

  /** 用库里的 payerId 拉实时详情，并回写 raw。示例案件直接读本地。 */
  async showDispute(id: string) {
    const existing = await this.disputes.findOne({ where: { id } });
    if (!existing?.payerId) throw new PayPalError('案件不存在或尚未同步', { status: 404 });
    if (existing.raw?.sample === true) return this.present(existing);
    const detail = await this.paypal.getDispute(existing.payerId, id);
    const saved = await this.savePaypalDispute(existing.payerId, detail, true);
    return this.present(saved);
  }

  /**
   * 提交证据。没有文件时走 JSON；有文件时按 PayPal 要求改成 multipart。
   * 允许 JPG、PNG、GIF、PDF，单文件小于 10MB，一次最多 5 个、合计小于 50MB。
   */
  async provideEvidence(
    id: string,
    body: { notes?: string; trackingNumber?: string; carrierName?: string; evidenceType?: string },
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string; size: number }>,
  ) {
    const existing = await this.disputes.findOne({ where: { id } });
    if (!existing?.payerId) throw new PayPalError('案件不存在或尚未同步', { status: 404 });
    this.assertEvidenceFiles(files);
    const names = files.map((file) => file.originalname);
    const input = {
      notes: body.notes,
      trackingNumber: body.trackingNumber,
      carrierName: body.carrierName,
      evidenceType: body.evidenceType,
      fileNames: names,
    };
    const payload = this.buildActionBody('provide-evidence', input, existing);
    if (existing.raw?.sample === true) {
      const raw = this.applySampleAction(existing, 'provide-evidence', input);
      const saved = await this.disputes.save(
        this.disputes.create({
          ...existing,
          status: String(raw.status || existing.status),
          raw,
        }),
      );
      await this.replaceEvents(saved);
      return this.present(saved);
    }
    if (files.length) {
      await this.paypal.provideEvidence(existing.payerId, id, payload, files);
    } else {
      await this.paypal.actOnDispute(existing.payerId, id, 'provide-evidence', payload);
    }
    return this.showDispute(id);
  }

  /**
   * 给买家发消息。无附件走 JSON；有附件走 multipart（PayPal 仅允许 JPG/PNG/GIF/PDF）。
   */
  async sendMessage(
    id: string,
    body: { message?: string },
    files: DisputeFile[] = [],
  ) {
    const existing = await this.disputes.findOne({ where: { id } });
    if (!existing?.payerId) throw new PayPalError('案件不存在或尚未同步', { status: 404 });
    this.assertEvidenceFiles(files);
    const payload = this.buildActionBody('send-message', {
      message: body.message,
      fileNames: files.map((file) => file.originalname),
    }, existing);
    if (existing.raw?.sample === true) {
      return this.saveSampleAction(existing, 'send-message', {
        message: body.message,
        fileNames: files.map((file) => file.originalname),
      });
    }
    await this.paypal.sendDisputeMessage(existing.payerId, id, payload, files);
    return this.showDispute(id);
  }

  /** 补充说明（provide-supporting-info），可选附件。 */
  async sendSupportingInfo(
    id: string,
    body: { notes?: string },
    files: DisputeFile[] = [],
  ) {
    const existing = await this.disputes.findOne({ where: { id } });
    if (!existing?.payerId) throw new PayPalError('案件不存在或尚未同步', { status: 404 });
    this.assertEvidenceFiles(files);
    const payload = this.buildActionBody('provide-supporting-info', {
      notes: body.notes,
      fileNames: files.map((file) => file.originalname),
    }, existing);
    if (existing.raw?.sample === true) {
      return this.saveSampleAction(existing, 'provide-supporting-info', {
        notes: body.notes,
        fileNames: files.map((file) => file.originalname),
      });
    }
    await this.paypal.provideSupportingInfo(existing.payerId, id, payload, files);
    return this.showDispute(id);
  }

  private async saveSampleAction(existing: DisputeEntity, action: string, body: Record<string, unknown>) {
    const raw = this.applySampleAction(existing, action, body);
    const saved = await this.disputes.save(
      this.disputes.create({
        ...existing,
        status: String(raw.status || existing.status),
        raw,
      }),
    );
    await this.replaceEvents(saved);
    return this.present(saved);
  }

  /** 提交证据、发消息、提议、接受索赔、升级或申诉，成功后刷新详情。 */
  async act(id: string, action: string, body: Record<string, unknown>) {
    const existing = await this.disputes.findOne({ where: { id } });
    if (!existing?.payerId) throw new PayPalError('案件不存在或尚未同步', { status: 404 });
    this.buildActionBody(action, body, existing);
    if (existing.raw?.sample === true) {
      const raw = this.applySampleAction(existing, action, body);
      const saved = await this.disputes.save(
        this.disputes.create({
          ...existing,
          status: String(raw.status || existing.status),
          raw,
        }),
      );
      await this.replaceEvents(saved);
      return this.present(saved);
    }
    await this.paypal.actOnDispute(existing.payerId, id, action, this.buildActionBody(action, body, existing));
    return this.showDispute(id);
  }

  /** 把前端表单收成 PayPal 各操作要求的 JSON。附件由 provideEvidence 另走 multipart。 */
  private buildActionBody(action: string, body: Record<string, unknown>, existing: DisputeEntity) {
    if (action === 'send-message') {
      const message = String(body.message || '').trim();
      if (!message) throw new PayPalError('请填写要发送的内容', { status: 400 });
      if (message.length > 2000) throw new PayPalError('消息不能超过 2000 字', { status: 400 });
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map((name) => String(name)) : [];
      return fileNames.length ? { message, documents: fileNames.map((name) => ({ name })) } : { message };
    }
    if (action === 'provide-supporting-info') {
      const notes = String(body.notes || body.message || '').trim();
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map((name) => String(name)) : [];
      if (!notes && !fileNames.length) throw new PayPalError('请填写补充说明或上传附件', { status: 400 });
      if (notes.length > 2000) throw new PayPalError('补充说明不能超过 2000 字', { status: 400 });
      return {
        notes: notes || `附件：${fileNames.join('、')}`,
        ...(fileNames.length ? { documents: fileNames.map((name) => ({ name })) } : {}),
      };
    }
    if (action === 'acknowledge-return-item') {
      const note = String(body.note || body.message || '').trim();
      const acknowledgementType = String(body.acknowledgementType || body.acknowledgement_type || 'ITEM_RECEIVED')
        .trim()
        .toUpperCase();
      const allowed = new Set(['ITEM_RECEIVED', 'ITEM_NOT_RECEIVED', 'DAMAGED']);
      if (!allowed.has(acknowledgementType)) {
        throw new PayPalError('acknowledgementType 只能是 ITEM_RECEIVED、ITEM_NOT_RECEIVED 或 DAMAGED', {
          status: 400,
        });
      }
      if (!note) throw new PayPalError('请填写退货确认说明', { status: 400 });
      return { note, acknowledgement_type: acknowledgementType };
    }
    if (action === 'provide-evidence') {
      const notes = String(body.notes || body.message || '').trim();
      const tracking = String(body.trackingNumber || '').trim();
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map((name) => String(name)) : [];
      if (notes.length > 2000) throw new PayPalError('证据说明不能超过 2000 字', { status: 400 });
      if (!notes && !tracking && !fileNames.length) {
        throw new PayPalError('请填写说明、物流单号，或上传证据文件', { status: 400 });
      }
      const evidenceType =
        String(body.evidenceType || '').trim() || (tracking ? 'PROOF_OF_FULFILLMENT' : 'OTHER');
      const evidence: Record<string, unknown> = {
        evidence_type: evidenceType,
        notes: notes || (fileNames.length ? `附件：${fileNames.join('、')}` : '卖家提交的履行证明'),
      };
      if (fileNames.length) {
        evidence.documents = fileNames.map((name) => ({ name }));
      }
      if (tracking) {
        evidence.evidence_info = {
          tracking_info: [
            {
              carrier_name: String(body.carrierName || 'OTHER'),
              tracking_number: tracking,
            },
          ],
        };
      }
      return { evidences: [evidence] };
    }
    if (action === 'make-offer') {
      const value = String(body.amount || existing.amount?.value || '').trim();
      const currency = String(body.currency || existing.amount?.currency_code || 'USD');
      if (!value) throw new PayPalError('请填写提议金额', { status: 400 });
      return {
        note: String(body.note || '卖家提议退款').trim(),
        offer_type: String(body.offerType || 'REFUND'),
        offer_amount: { currency_code: currency, value },
      };
    }
    if (action === 'accept-claim') {
      return { note: String(body.note || '卖家接受索赔').trim() };
    }
    if (action === 'escalate' || action === 'appeal') {
      const note = String(body.note || body.message || '').trim();
      if (!note) throw new PayPalError('请填写说明', { status: 400 });
      return action === 'appeal'
        ? { evidences: [{ evidence_type: 'OTHER', notes: note }] }
        : { note };
    }
    return body;
  }

  /**
   * isDetail 为 true 时整份覆盖 raw。
   * 列表同步时若已有详情（含 disputed_transactions），只更新状态、原因、金额和阶段。
   */
  private async savePaypalDispute(payerId: string, item: any, isDetail: boolean) {
    const id = String(item?.dispute_id || item?.id || '').trim();
    if (!id) throw new PayPalError('PayPal 未返回 dispute_id', { status: 502 });
    const existing = await this.disputes.findOne({ where: { id } });
    const raw = isDetail
      ? item
      : existing?.raw?.disputed_transactions
        ? {
            ...existing.raw,
            status: item.status,
            reason: item.reason,
            dispute_amount: item.dispute_amount,
            update_time: item.update_time,
            dispute_life_cycle_stage: item.dispute_life_cycle_stage || existing.raw.dispute_life_cycle_stage,
          }
        : item;
    const created = item.create_time || existing?.createdAt;
    const saved = await this.disputes.save(
      this.disputes.create({
        id,
        payerId,
        status: item.status || existing?.status || '',
        reason: item.reason || existing?.reason || '',
        amount: item.dispute_amount || existing?.amount || {},
        createdAt: created ? new Date(created) : null,
        raw,
      }),
    );
    await this.replaceEvents(saved);
    return saved;
  }

  /** 用案件里的留言和证据覆盖事件表，保证和详情一致。 */
  private async replaceEvents(row: DisputeEntity) {
    const raw = row.raw || {};
    const messages = Array.isArray(raw.messages) ? raw.messages : [];
    const evidences = Array.isArray(raw.evidences) ? raw.evidences : [];
    const rows: DisputeEventEntity[] = [];
    messages.forEach((msg: any, index: number) => {
      rows.push(
        this.events.create({
          id: `${row.id}:message:${index}`,
          disputeId: row.id,
          payerId: row.payerId,
          kind: 'message',
          occurredAt: this.asEventDate(msg?.time_posted),
          author: String(msg?.posted_by || '').slice(0, 64),
          content: String(msg?.content || ''),
          evidenceType: '',
          raw: msg || {},
        }),
      );
    });
    evidences.forEach((ev: any, index: number) => {
      rows.push(
        this.events.create({
          id: `${row.id}:evidence:${index}`,
          disputeId: row.id,
          payerId: row.payerId,
          kind: 'evidence',
          occurredAt: this.asEventDate(ev?.date),
          author: String(ev?.source || '').slice(0, 64),
          content: String(ev?.notes || ''),
          evidenceType: String(ev?.evidence_type || '').slice(0, 64),
          raw: ev || {},
        }),
      );
    });
    await this.events.delete({ disputeId: row.id });
    if (rows.length) await this.events.save(rows);
  }

  private asEventDate(value: unknown) {
    if (!value) return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private assertEvidenceFiles(files: Array<{ originalname: string; mimetype: string; size: number }>) {
    const limits = this.paypal.config();
    const maxMb = Math.round(limits.evidenceMaxFileBytes / (1024 * 1024));
    const totalMb = Math.round(limits.evidenceMaxTotalBytes / (1024 * 1024));
    const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'application/pdf']);
    if (files.length > limits.evidenceMaxFiles) {
      throw new PayPalError(`最多上传 ${limits.evidenceMaxFiles} 个文件`, { status: 400 });
    }
    let total = 0;
    for (const file of files) {
      const name = String(file.originalname || '').toLowerCase();
      const type = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
      if (!allowed.has(type) || !/\.(jpe?g|png|gif|pdf)$/.test(name)) {
        throw new PayPalError('只支持 JPG、PNG、GIF、PDF', { status: 400 });
      }
      if (file.size > limits.evidenceMaxFileBytes) {
        throw new PayPalError(`单个文件不能超过 ${maxMb}MB`, { status: 400 });
      }
      total += file.size;
    }
    if (total > limits.evidenceMaxTotalBytes) {
      throw new PayPalError(`本次上传合计不能超过 ${totalMb}MB`, { status: 400 });
    }
  }

  /** 从交易缓存里挑几笔正向交易，两个账号轮流取，避免示例都堆在同一个商家。 */
  private async sampleTransactions() {
    const accounts = await this.accounts.findAll();
    const buckets: Array<
      Array<{
        payerId: string;
        transactionId: string;
        amount: { currency_code: string; value: string };
        buyerEmail: string;
        subject: string;
      }>
    > = [];
    for (const acc of accounts) {
      const { items } = await this.accounts.readTransactions(acc.payerId);
      const rows = [];
      for (const item of items as any[]) {
        const info = item?.transaction_info || {};
        const value = String(info?.transaction_amount?.value || '');
        if (!info.transaction_id || !value || Number(value) <= 0) continue;
        rows.push({
          payerId: acc.payerId,
          transactionId: String(info.transaction_id),
          amount: {
            currency_code: String(info.transaction_amount?.currency_code || 'USD'),
            value,
          },
          buyerEmail: String(item?.payer_info?.email_address || ''),
          subject: String(info.transaction_subject || ''),
        });
        if (rows.length >= 4) break;
      }
      if (rows.length) buckets.push(rows);
    }
    const picked = [];
    const depth = Math.max(0, ...buckets.map((rows) => rows.length));
    for (let index = 0; index < depth && picked.length < 5; index += 1) {
      for (const rows of buckets) {
        if (rows[index]) picked.push(rows[index]);
        if (picked.length >= 5) break;
      }
    }
    return picked;
  }

  /** 示例案件的回应只改本地记录，方便在详情页看到消息、证据和状态变化。 */
  private applySampleAction(existing: DisputeEntity, action: string, body: Record<string, unknown>) {
    const raw: Record<string, any> = { ...(existing.raw || {}) };
    const messages = Array.isArray(raw.messages) ? [...raw.messages] : [];
    const evidences = Array.isArray(raw.evidences) ? [...raw.evidences] : [];
    const now = new Date().toISOString();
    const say = (text: string) => messages.push({ posted_by: 'SELLER', time_posted: now, content: text });
    if (action === 'send-message') {
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map((name) => String(name)) : [];
      messages.push({
        posted_by: 'SELLER',
        time_posted: now,
        content: String(body.message || ''),
        documents: fileNames.map((name) => ({ name })),
      });
      raw.status = 'WAITING_FOR_BUYER_RESPONSE';
    } else if (action === 'provide-supporting-info') {
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map((name) => String(name)) : [];
      say(String(body.notes || body.message || '卖家补充说明'));
      if (fileNames.length) {
        evidences.push({
          evidence_type: 'OTHER',
          source: 'SUBMITTED_BY_SELLER',
          notes: `补充说明附件：${fileNames.join('、')}`,
          documents: fileNames.map((name) => ({ name })),
        });
      }
      raw.status = 'UNDER_REVIEW';
    } else if (action === 'acknowledge-return-item') {
      say(
        `退货确认（${String(body.acknowledgementType || body.acknowledgement_type || 'ITEM_RECEIVED')}）：${String(body.note || body.message || '')}`,
      );
      raw.status = 'UNDER_REVIEW';
    } else if (action === 'provide-evidence') {
      const tracking = String(body.trackingNumber || '').trim();
      const notes = String(body.notes || body.message || '').trim();
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames.map((name) => String(name)) : [];
      evidences.push({
        evidence_type: String(body.evidenceType || '').trim() || (tracking ? 'PROOF_OF_FULFILLMENT' : 'OTHER'),
        source: 'SUBMITTED_BY_SELLER',
        notes: [notes, tracking ? `物流单号 ${tracking}` : '', fileNames.length ? `附件：${fileNames.join('、')}` : '']
          .filter(Boolean)
          .join('；'),
        documents: fileNames.map((name) => ({ name })),
      });
      raw.status = 'UNDER_REVIEW';
    } else if (action === 'make-offer') {
      say(String(body.note || '卖家提议退款'));
      raw.status = 'WAITING_FOR_BUYER_RESPONSE';
    } else if (action === 'accept-claim') {
      say(String(body.note || '卖家接受索赔'));
      raw.status = 'RESOLVED';
      raw.dispute_outcome = { outcome_code: 'RESOLVED_BUYER_FAVOUR' };
    } else if (action === 'escalate') {
      say(String(body.note || body.message || ''));
      raw.status = 'UNDER_REVIEW';
      raw.dispute_life_cycle_stage = 'CHARGEBACK';
    } else if (action === 'appeal') {
      raw.status = 'UNDER_REVIEW';
      raw.dispute_life_cycle_stage = 'ARBITRATION';
      evidences.push({
        evidence_type: 'OTHER',
        source: 'SUBMITTED_BY_SELLER',
        notes: String(body.note || body.message || ''),
      });
    }
    raw.messages = messages;
    raw.evidences = evidences;
    raw.update_time = now;
    raw.sample = true;
    return raw;
  }

  /** 详情和操作结果都从案件事件表组装留言和证据。 */
  private async present(row: DisputeEntity) {
    const events = await this.events.find({ where: { disputeId: row.id }, order: { occurredAt: 'ASC' } });
    return this.toPublic(row, events);
  }

  /** 列表和详情共用的前端结构。留言和证据优先用 pp_dispute_event。 */
  private toPublic(row: DisputeEntity, events: DisputeEventEntity[] = []) {
    const raw = row.raw || {};
    const tx = Array.isArray(raw.disputed_transactions) ? raw.disputed_transactions[0] : null;
    const messageEvents = events.filter((event) => event.kind === 'message');
    const evidenceEvents = events.filter((event) => event.kind === 'evidence');
    const messages = messageEvents.length
      ? messageEvents.map((event) =>
          event.raw && Object.keys(event.raw).length
            ? event.raw
            : { posted_by: event.author, time_posted: event.occurredAt?.toISOString() || '', content: event.content },
        )
      : Array.isArray(raw.messages)
        ? raw.messages
        : [];
    const evidences = evidenceEvents.length
      ? evidenceEvents.map((event) =>
          event.raw && Object.keys(event.raw).length
            ? event.raw
            : { evidence_type: event.evidenceType, notes: event.content, source: event.author },
        )
      : Array.isArray(raw.evidences)
        ? raw.evidences
        : [];
    const stage = String(raw.dispute_life_cycle_stage || '');
    const status = String(row.status || '');
    const outcome = String((raw.dispute_outcome as { outcome_code?: string } | undefined)?.outcome_code || '');
    return {
      id: row.id,
      payerId: row.payerId,
      status,
      reason: row.reason,
      amount: row.amount?.value ? row.amount : raw.dispute_amount || row.amount,
      createdAt: row.createdAt ? row.createdAt.toISOString() : raw.create_time || '',
      relatedTransactionId: tx?.seller_transaction_id || tx?.buyer_transaction_id || '',
      buyerEmail: tx?.buyer?.email || '',
      deadlineAt: raw.seller_response_due_date || '',
      caseType: stage,
      lifeCycleStage: stage,
      notes: messages.map((msg: any) => ({
        at: msg.time_posted || '',
        text: msg.content || '',
        author: msg.posted_by || '',
        documents: Array.isArray(msg.documents) ? msg.documents : [],
      })),
      evidences,
      sample: raw.sample === true,
      updatedAt: String(raw.update_time || ''),
      itemName: tx?.items?.[0]?.item_name || tx?.items?.[0]?.item_description || '',
      outcome,
      /**
       * 当前阶段可执行的操作。优先解析 PayPal 详情里的 HATEOAS links；
       * 示例案件或 links 缺失时用 status / stage 启发式兜底。
       */
      allowedActions: this.resolveAllowedActions(raw, status, stage, outcome),
    };
  }

  /**
   * 从 PayPal dispute.links 解析可执行 action（rel 或 href 末段）。
   * 例：rel=provide_evidence / href=.../provide-evidence → provide-evidence
   */
  private resolveAllowedActions(
    raw: Record<string, any>,
    status: string,
    stage: string,
    outcome: string,
  ): string[] {
    const known = new Set([
      'provide-evidence',
      'send-message',
      'make-offer',
      'accept-claim',
      'escalate',
      'appeal',
      'acknowledge-return-item',
      'provide-supporting-info',
    ]);
    const fromLinks = new Set<string>();
    for (const link of Array.isArray(raw.links) ? raw.links : []) {
      const rel = String(link?.rel || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-');
      const hrefTail = String(link?.href || '')
        .split('?')[0]
        .split('/')
        .filter(Boolean)
        .pop()
        ?.toLowerCase()
        .replace(/_/g, '-');
      if (known.has(rel)) fromLinks.add(rel);
      if (hrefTail && known.has(hrefTail)) fromLinks.add(hrefTail);
    }
    if (fromLinks.size) return [...fromLinks];

    // 无 links（示例或摘要）：按状态/阶段推断，避免详情页全部灰掉
    if (status === 'RESOLVED') {
      return outcome === 'RESOLVED_BUYER_FAVOUR' || outcome === 'RESOLVED_WITH_PAYOUT' ? ['appeal'] : [];
    }
    if (status === 'WAITING_FOR_BUYER_RESPONSE') {
      return ['send-message'];
    }
    const actions = new Set<string>(['send-message', 'provide-evidence', 'make-offer', 'accept-claim']);
    if (stage === 'INQUIRY' || !stage) actions.add('escalate');
    if (stage === 'CHARGEBACK' || stage === 'PRE_ARBITRATION' || stage === 'ARBITRATION') {
      actions.add('appeal');
      actions.add('acknowledge-return-item');
      actions.add('provide-supporting-info');
    }
    if (status === 'WAITING_FOR_SELLER_RESPONSE' || status === 'OPEN' || status === 'UNDER_REVIEW') {
      return [...actions];
    }
    return [...actions];
  }

  /**
   * 接收 PayPal Webhook：落库 →（可选）验签 → 对 CUSTOMER.DISPUTE.* 拉详情回写状态。
   * 处理失败仍返回 ok，避免 PayPal 因业务错误无限重试；验签失败则抛 400。
   */
  async handlePaypalWebhook(headers: Record<string, string>, event: any) {
    const eventId = String(event?.id || '').trim();
    if (eventId) {
      const exists = await this.webhooks
        .createQueryBuilder('w')
        .where(`w.event->>'id' = :id`, { id: eventId })
        .getOne();
      if (exists) return { ok: true, duplicate: true, eventId };
    }

    const verifyOn = ['1', 'true', 'yes'].includes(
      String(process.env.PAYPAL_WEBHOOK_VERIFY || '').trim().toLowerCase(),
    );
    if (verifyOn) {
      await this.paypal.verifyWebhookSignature(headers, event);
    }

    await this.appendWebhook({
      headers,
      event: event || {},
    });

    const eventType = String(event?.event_type || '');
    if (!/^CUSTOMER\.DISPUTE\./i.test(eventType)) {
      return { ok: true, handled: false, eventType };
    }

    try {
      const applied = await this.applyDisputeWebhook(event);
      return { ok: true, handled: true, eventType, ...applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理争议 Webhook 失败';
      this.logger.warn(`Webhook ${eventType} 未更新案件：${message}`);
      return { ok: true, handled: false, eventType, error: message };
    }
  }

  /** 用 webhook resource 更新本地状态，再按商家令牌拉完整详情。 */
  private async applyDisputeWebhook(event: any) {
    const resource = event?.resource || {};
    const disputeId = String(resource.dispute_id || resource.id || '').trim();
    if (!disputeId) throw new PayPalError('Webhook 缺少 dispute_id', { status: 400 });
    const payerId = await this.resolveWebhookPayerId(resource, disputeId);
    if (!payerId) throw new PayPalError(`找不到案件 ${disputeId} 对应的商家账号`, { status: 404 });
    await this.savePaypalDispute(payerId, resource, false);
    try {
      await this.showDispute(disputeId);
    } catch (error) {
      this.logger.warn(
        `Webhook 已写入摘要，拉详情失败 ${disputeId}：${error instanceof Error ? error.message : error}`,
      );
    }
    const saved = await this.disputes.findOne({ where: { id: disputeId } });
    return { disputeId, payerId, status: saved?.status || String(resource.status || '') };
  }

  private async resolveWebhookPayerId(resource: any, disputeId: string) {
    const existing = await this.disputes.findOne({ where: { id: disputeId } });
    if (existing?.payerId) return existing.payerId;
    const hinted = String(
      resource.seller?.merchant_id ||
        resource.disputed_transactions?.[0]?.seller?.merchant_id ||
        resource.disputed_transactions?.[0]?.seller_transaction_id ||
        '',
    ).trim();
    if (hinted) {
      const acc = await this.accounts.findOne(hinted);
      if (acc?.refreshToken) return acc.payerId;
    }
    const accounts = (await this.accounts.findAll()).filter((acc) => acc.refreshToken);
    for (const acc of accounts) {
      try {
        await this.paypal.getDispute(acc.payerId, disputeId);
        return acc.payerId;
      } catch {
        /* 该商家看不到此案件 */
      }
    }
    return '';
  }

  async appendWebhook(entry: { id?: string; headers: Record<string, string>; event: any }) {
    await this.webhooks.save(
      this.webhooks.create({
        id: entry.id || randomBytes(8).toString('hex'),
        receivedAt: new Date(),
        headers: entry.headers,
        event: entry.event || {},
      }),
    );
    await this.webhooks.query(
      `DELETE FROM pp_webhook_event WHERE id NOT IN (SELECT id FROM pp_webhook_event ORDER BY received_at DESC LIMIT 500)`,
    );
  }

  async listWebhooks(limit: number) {
    const rows = await this.webhooks.find({ order: { receivedAt: 'DESC' }, take: limit });
    return rows.map((row) => ({
      id: row.id,
      receivedAt: row.receivedAt?.toISOString?.() || '',
      headers: row.headers,
      event: row.event,
    }));
  }

  async appendLog(entry: Partial<ApiLogEntity>) {
    await this.logs.save(
      this.logs.create({
        at: entry.at ? new Date(entry.at) : new Date(),
        method: entry.method || '',
        path: entry.path || '',
        status: entry.status || 0,
        userId: entry.userId || '',
        payerId: entry.payerId || '',
        debugId: entry.debugId || '',
        message: String(entry.message || '').slice(0, 500),
        ms: entry.ms || 0,
      }),
    );
  }

  async listLogs(limit: number) {
    const rows = await this.logs.find({ order: { at: 'DESC' }, take: limit });
    return rows.map((row) => ({
      at: row.at?.toISOString?.() || '',
      method: row.method,
      path: row.path,
      status: row.status,
      userId: row.userId,
      payerId: row.payerId,
      debugId: row.debugId,
      message: row.message,
      ms: row.ms,
    }));
  }

  /** 首页数字。收款按交易事件码 T000x / T11 粗分，争议只计未结案。 */
  async stats() {
    const accounts = await this.accounts.findAll();
    let totalReceived = 0;
    let totalWithdrawn = 0;
    for (const acc of accounts) {
      const { items } = await this.accounts.readTransactions(acc.payerId);
      for (const tx of items as any[]) {
        const amount = Number(tx?.transaction_info?.transaction_amount?.value || 0);
        const code = tx?.transaction_info?.transaction_event_code || '';
        if (amount > 0 && /^(T000[0-9]|T11)/.test(code)) totalReceived += amount;
        if (amount < 0 || /withdraw|payout/i.test(tx?.transaction_info?.transaction_subject || '')) {
          totalWithdrawn += Math.abs(amount);
        }
      }
    }
    const disputes = await this.listDisputes();
    const open = disputes.filter((d) => d.status !== 'RESOLVED');
    const isInquiry = (d: { lifeCycleStage?: string; caseType?: string }) =>
      String(d.lifeCycleStage || d.caseType || 'INQUIRY') === 'INQUIRY';
    const complaintCount = open.filter(isInquiry).length;
    const disputeCaseCount = open.filter((d) => !isInquiry(d)).length;
    return {
      accountCount: accounts.length,
      authorizedCount: accounts.filter((a) => a.refreshToken).length,
      totalReceived: Math.round(totalReceived * 100) / 100,
      totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
      /** 未结案合计；首页「待处理」兼容字段 */
      disputeCount: open.length,
      complaintCount,
      disputeCaseCount,
      lastDisputeSyncAt: this.lastAutoSync?.at || '',
      lastDisputeSyncOk: this.lastAutoSync?.ok ?? null,
      lastDisputeSyncMessage: this.lastAutoSync?.message || '',
    };
  }
}
