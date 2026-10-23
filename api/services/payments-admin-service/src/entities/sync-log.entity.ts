import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 同步任务执行记录。只留最近 500 条。 */
@Entity({ name: 'pp_sync_log', comment: '同步执行记录' })
export class SyncLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '记录编号' })
  id: string;

  @Column({ name: 'task_id', type: 'varchar', length: 32, default: '', comment: '所属任务编号' })
  taskId: string;

  @Column({ type: 'varchar', length: 32, default: '', comment: '任务类型：transactions 或 disputes' })
  type: string;

  @Column({ name: 'payer_id', type: 'varchar', length: 32, default: '', comment: '本次涉及的商家；空表示汇总' })
  payerId: string;

  /** schedule | manual */
  @Column({ name: 'trigger_by', type: 'varchar', length: 16, default: 'schedule', comment: '触发方式：schedule 或 manual' })
  triggerBy: string;

  /** success | failed | skipped */
  @Column({ type: 'varchar', length: 16, default: '', comment: '执行结果' })
  status: string;

  @Column({ type: 'int', default: 0, comment: '写入条数' })
  count: number;

  @Column({ type: 'text', default: '', comment: '结果说明' })
  message: string;

  @Column({ name: 'started_at', type: 'timestamptz', comment: '开始时间' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true, comment: '结束时间' })
  finishedAt: Date | null;

  @Column({ type: 'int', default: 0, comment: '耗时，毫秒' })
  ms: number;
}
