import { Column, Entity, PrimaryColumn } from 'typeorm';

/** 商家跳转 PayPal 授权时的临时会话。回调核对 state 后即可删除。 */
@Entity({ name: 'pp_oauth_session', comment: 'PayPal 授权临时会话' })
export class OauthSessionEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '会话编号，写在 Cookie 里' })
  id: string;

  @Column({ name: 'expires_at', type: 'timestamptz', comment: '会话过期时间' })
  expiresAt: Date;

  @Column({ type: 'varchar', length: 64, default: '', comment: 'OAuth state，空表示尚未发起授权' })
  state: string;

  @Column({ type: 'varchar', length: 64, default: '', comment: 'OAuth nonce' })
  nonce: string;

  @Column({ name: 'oauth_expires_at', type: 'timestamptz', nullable: true, comment: 'state 过期时间' })
  oauthExpiresAt: Date | null;

  @Column({ name: 'link_payer_id', type: 'varchar', length: 32, default: '', comment: '重新授权时要绑定的商家编号' })
  linkPayerId: string;
}
