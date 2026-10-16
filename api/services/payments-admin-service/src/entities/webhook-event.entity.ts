import { Column, Entity, PrimaryColumn } from 'typeorm';

/** PayPal Webhook 原文。只留最近 500 条，用于排查，不驱动业务状态机。 */
@Entity({ name: 'pp_webhook_event', comment: 'PayPal Webhook 事件' })
export class WebhookEventEntity {
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '本地事件编号' })
  id: string;

  @Column({ name: 'received_at', type: 'timestamptz', comment: '本服务收到事件的时间' })
  receivedAt: Date;

  /** 目前只保留 paypal-transmission-id 与 paypal-transmission-time。 */
  @Column({ type: 'jsonb', default: {}, comment: 'PayPal 回调头，含 transmission id 与 time' })
  headers: Record<string, string>;

  /** 完整事件体，event_type 如 CUSTOMER.DISPUTE.CREATED。 */
  @Column({ type: 'jsonb', default: {}, comment: '事件正文，含 event_type 与 resource' })
  event: Record<string, unknown>;
}
