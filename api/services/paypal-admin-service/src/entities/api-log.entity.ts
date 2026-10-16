import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** 调用 PayPal 或本服务接口时留下的简要日志。 */
@Entity({ name: 'pp_api_log', comment: 'PayPal 接口调用日志' })
export class ApiLogEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '日志编号' })
  id: string;

  @Column({ type: 'timestamptz', comment: '发生时间' })
  at: Date;

  @Column({ type: 'varchar', length: 12, default: '', comment: 'HTTP 方法' })
  method: string;

  @Column({ type: 'text', default: '', comment: '请求路径' })
  path: string;

  @Column({ type: 'int', default: 0, comment: 'HTTP 状态码' })
  status: number;

  @Column({ name: 'user_id', type: 'varchar', length: 64, default: '', comment: '操作人用户编号' })
  userId: string;

  @Column({ name: 'payer_id', type: 'varchar', length: 32, default: '', comment: '涉及的商家编号，没有则为空' })
  payerId: string;

  @Column({ name: 'debug_id', type: 'varchar', length: 64, default: '', comment: 'PayPal 返回的 paypal-debug-id' })
  debugId: string;

  @Column({ type: 'text', default: '', comment: '结果说明，最长保留 500 字' })
  message: string;

  @Column({ type: 'int', default: 0, comment: '耗时，毫秒' })
  ms: number;
}
