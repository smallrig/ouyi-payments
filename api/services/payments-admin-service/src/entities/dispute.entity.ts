import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 从 PayPal Customer Disputes API 同步下来的争议案件。
 * 列表接口只给摘要，详情接口会把完整对象写入 raw。
 */
@Entity({ name: 'pp_dispute', comment: 'PayPal 争议案件' })
export class DisputeEntity {
  /** 对应 PayPal dispute_id，例如 PP-R-XXX。 */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: 'PayPal 争议编号（dispute_id）' })
  id: string;

  @Column({
    name: 'payer_id',
    type: 'varchar',
    length: 32,
    default: '',
    comment: '所属商家编号，对应 pp_account.payer_id',
  })
  payerId: string;

  /** OPEN、WAITING_FOR_SELLER_RESPONSE、UNDER_REVIEW、RESOLVED 等。 */
  @Column({ type: 'varchar', length: 32, default: '', comment: '争议状态，如 OPEN、UNDER_REVIEW、RESOLVED' })
  status: string;

  /** 例如 MERCHANDISE_OR_SERVICE_NOT_RECEIVED、MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED。 */
  @Column({ type: 'varchar', length: 80, default: '', comment: '买家发起原因，如未收到商品、商品与描述不符' })
  reason: string;

  /** 形如 { currency_code, value }，对应 dispute_amount。 */
  @Column({ type: 'jsonb', default: {}, comment: '争议金额，含 currency_code 与 value' })
  amount: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', nullable: true, comment: '争议创建时间' })
  createdAt: Date | null;

  /**
   * PayPal 原始对象。列表同步时若这里已有 disputed_transactions，
   * 只覆盖状态、原因、金额和阶段，避免摘要把详情冲掉。
   */
  @Column({
    type: 'jsonb',
    default: {},
    comment: 'PayPal 原始争议对象，含阶段、截止时间、消息、证据与可执行操作',
  })
  raw: Record<string, unknown>;
}
