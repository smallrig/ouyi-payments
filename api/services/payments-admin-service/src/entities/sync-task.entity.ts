import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 定时同步任务配置：交易流水或争议。payerId 为空表示全部已授权账号。 */
@Entity({ name: 'pp_sync_task', comment: '同步任务配置' })
export class SyncTaskEntity {
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '任务编号' })
  id: string;

  @Column({ type: 'varchar', length: 80, default: '', comment: '任务名称' })
  name: string;

  /** transactions | disputes */
  @Column({ type: 'varchar', length: 32, default: 'transactions', comment: '任务类型：transactions 或 disputes' })
  type: string;

  @Column({ name: 'payer_id', type: 'varchar', length: 32, default: '', comment: '指定商家；空表示全部已授权账号' })
  payerId: string;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ name: 'interval_sec', type: 'int', default: 900, comment: '执行间隔（秒）' })
  intervalSec: number;

  @Column({ name: 'lookback_days', type: 'int', default: 31, comment: '交易回溯天数，仅交易任务有效' })
  lookbackDays: number;

  /** idle | running | success | failed */
  @Column({ type: 'varchar', length: 16, default: 'idle', comment: '最近一次执行状态' })
  status: string;

  @Column({ name: 'last_message', type: 'text', default: '', comment: '最近一次执行说明' })
  lastMessage: string;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true, comment: '最近一次开始时间' })
  lastRunAt: Date | null;

  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true, comment: '下次计划执行时间' })
  nextRunAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', comment: '创建时间' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', comment: '更新时间' })
  updatedAt: Date;
}
