import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 已接入的 PayPal 商家账号，含授权令牌与后台分配信息。 */
@Entity({ name: 'pp_account', comment: 'PayPal 商家账号' })
export class PayPalAccountEntity {
  /** PayPal 商家编号，授权后从 userinfo.payer_id 取得。 */
  @PrimaryColumn({
    name: 'payer_id',
    type: 'varchar',
    length: 32,
    comment: 'PayPal 商家编号（payer_id）',
  })
  payerId: string;

  @Column({ type: 'varchar', length: 320, default: '', comment: '商家邮箱' })
  email: string;

  @Column({ type: 'varchar', length: 200, default: '', comment: '商家显示名称' })
  name: string;

  /** active 正常可用，frozen 冻结，pending 已建档但尚未完成授权或已解除授权。 */
  @Column({
    type: 'varchar',
    length: 16,
    default: 'pending',
    comment: '账号状态：active 正常，frozen 冻结，pending 待授权',
  })
  status: string;

  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
    comment: '账面余额，未同步时为空',
    transformer: { to: (v) => v, from: (v) => (v == null ? null : Number(v)) },
  })
  balance: number | null;

  @Column({
    name: 'frozen_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '冻结金额',
    transformer: { to: (v) => v, from: (v) => (v == null ? 0 : Number(v)) },
  })
  frozenAmount: number;

  @Column({
    name: 'owner_user_id',
    type: 'varchar',
    length: 64,
    default: '',
    comment: '负责人用户编号，空表示尚未分配',
  })
  ownerUserId: string;

  @Column({ name: 'owner_name', type: 'varchar', length: 120, default: '', comment: '负责人姓名' })
  ownerName: string;

  /** 长期凭证。解除授权时清空，之后不能再代商家调 PayPal。 */
  @Column({ name: 'refresh_token', type: 'text', default: '', comment: 'OAuth 刷新令牌，解除授权后清空' })
  refreshToken: string;

  @Column({ name: 'access_token', type: 'text', default: '', comment: '当前访问令牌，过期后用刷新令牌更换' })
  accessToken: string;

  @Column({ name: 'token_type', type: 'varchar', length: 32, default: 'Bearer', comment: '令牌类型，一般为 Bearer' })
  tokenType: string;

  /** Unix 毫秒时间戳，不是秒。 */
  @Column({
    name: 'expires_at',
    type: 'bigint',
    default: 0,
    comment: '访问令牌过期时间，Unix 毫秒时间戳',
    transformer: { to: (v) => v, from: (v) => Number(v || 0) },
  })
  expiresAt: number;

  @Column({ type: 'text', default: '', comment: '授权时 PayPal 授予的权限范围' })
  scope: string;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true, comment: '最近一次同步交易的时间' })
  lastSyncedAt: Date | null;

  @Column({ type: 'text', default: '', comment: '后台备注' })
  note: string;

  @Column({ name: 'obtained_at', type: 'timestamptz', nullable: true, comment: '首次授权成功时间' })
  obtainedAt: Date | null;

  @Column({ name: 'refreshed_at', type: 'timestamptz', nullable: true, comment: '最近一次刷新令牌的时间' })
  refreshedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', comment: '更新时间' })
  updatedAt: Date;
}
