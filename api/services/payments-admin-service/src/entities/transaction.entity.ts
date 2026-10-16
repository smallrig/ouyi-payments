import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 单笔 PayPal 交易。同步流水时从缓存里拆出来，方便按交易号查询。 */
@Entity({ name: 'pp_transaction', comment: 'PayPal 交易记录' })
export class TransactionEntity {
  @PrimaryColumn({ name: 'payer_id', type: 'varchar', length: 32, comment: '商家编号，对应 pp_account.payer_id' })
  payerId: string;

  @PrimaryColumn({ name: 'transaction_id', type: 'varchar', length: 32, comment: 'PayPal 交易号' })
  transactionId: string;

  @Column({ name: 'event_code', type: 'varchar', length: 16, default: '', comment: '交易事件码，如 T0006' })
  eventCode: string;

  @Column({ type: 'varchar', length: 32, default: '', comment: '交易状态，如 S 成功' })
  status: string;

  @Column({ name: 'amount_value', type: 'numeric', precision: 18, scale: 2, default: 0, comment: '交易金额' })
  amountValue: number;

  @Column({ name: 'currency_code', type: 'varchar', length: 8, default: '', comment: '币种' })
  currencyCode: string;

  @Column({ name: 'buyer_email', type: 'varchar', length: 320, default: '', comment: '买家邮箱' })
  buyerEmail: string;

  @Column({ type: 'varchar', length: 512, default: '', comment: '交易标题或商品说明' })
  subject: string;

  @Column({ name: 'invoice_id', type: 'varchar', length: 127, default: '', comment: '发票号' })
  invoiceId: string;

  @Column({ name: 'custom_field', type: 'varchar', length: 256, default: '', comment: '自定义字段，通常是订单号' })
  customField: string;

  @Column({ name: 'initiated_at', type: 'timestamptz', nullable: true, comment: '交易发生时间' })
  initiatedAt: Date | null;

  @Column({ name: 'paypal_updated_at', type: 'timestamptz', nullable: true, comment: 'PayPal 侧更新时间' })
  paypalUpdatedAt: Date | null;

  @Column({ type: 'jsonb', default: {}, comment: 'PayPal 返回的完整交易对象' })
  raw: Record<string, unknown>;
}
