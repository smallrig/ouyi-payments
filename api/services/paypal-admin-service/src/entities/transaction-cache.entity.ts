import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 按商家缓存的交易流水，避免每次打开列表都打 Reporting API。 */
@Entity({ name: 'pp_transaction_cache', comment: 'PayPal 交易流水缓存' })
export class TransactionCacheEntity {
  @PrimaryColumn({
    name: 'payer_id',
    type: 'varchar',
    length: 32,
    comment: '商家编号，对应 pp_account.payer_id',
  })
  payerId: string;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true, comment: '本次缓存从 PayPal 拉回的时间' })
  syncedAt: Date | null;

  /** 含 start_date、end_date、days。Reporting API 单次最多 31 天。 */
  @Column({ type: 'jsonb', default: {}, comment: '同步区间，含 start_date、end_date、days' })
  range: Record<string, unknown>;

  /** transaction_details 数组，结构与 PayPal Reporting 接口一致。 */
  @Column({ type: 'jsonb', default: [], comment: '交易明细数组，对应 transaction_details' })
  items: unknown[];

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', comment: '缓存写入时间' })
  updatedAt: Date;
}
