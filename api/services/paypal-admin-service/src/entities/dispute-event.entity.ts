import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 争议案件里的一条动态：买家或卖家留言，或一次证据提交。 */
@Entity({ name: 'pp_dispute_event', comment: '争议案件事件' })
export class DisputeEventEntity {
  @PrimaryColumn({ type: 'varchar', length: 96, comment: '事件编号，由案件号、类型和序号组成' })
  id: string;

  @Column({ name: 'dispute_id', type: 'varchar', length: 64, comment: '所属争议编号，对应 pp_dispute.id' })
  disputeId: string;

  @Column({ name: 'payer_id', type: 'varchar', length: 32, default: '', comment: '所属商家编号' })
  payerId: string;

  /** message 留言，evidence 证据。 */
  @Column({ type: 'varchar', length: 16, default: '', comment: '事件类型：message 留言，evidence 证据' })
  kind: string;

  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true, comment: '事件发生时间' })
  occurredAt: Date | null;

  @Column({ type: 'varchar', length: 64, default: '', comment: '提交方，如 BUYER、SELLER、PAYPAL' })
  author: string;

  @Column({ type: 'text', default: '', comment: '留言内容或证据说明' })
  content: string;

  @Column({ name: 'evidence_type', type: 'varchar', length: 64, default: '', comment: '证据类型，留言为空' })
  evidenceType: string;

  @Column({ type: 'jsonb', default: {}, comment: 'PayPal 返回的原始事件对象' })
  raw: Record<string, unknown>;
}
