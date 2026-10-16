import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { OauthSessionEntity } from '../entities/oauth-session.entity';

type Session = {
  id: string;
  expiresAt: number;
  oauth?: { state: string; nonce: string; expiresAt: number; linkPayerId: string };
};

/** 授权 state 存在 pp_oauth_session。过期行在读取时清掉。 */
@Injectable()
export class OauthSessionService {
  constructor(
    @InjectRepository(OauthSessionEntity)
    private readonly sessions: Repository<OauthSessionEntity>,
    private readonly config: ConfigService,
  ) {}

  cookieName() {
    return (this.config.get<string>('OAUTH_COOKIE_NAME') || 'pp_admin_oauth').trim();
  }

  private ttlMs() {
    return Number(this.config.get('OAUTH_SESSION_TTL_SEC') || 900) * 1000;
  }

  async read(cookieHeader = ''): Promise<Session | null> {
    const id = this.cookieValue(cookieHeader);
    if (!id) return null;
    const row = await this.sessions.findOne({ where: { id } });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      if (row) await this.sessions.delete({ id });
      return null;
    }
    return this.toSession(row);
  }

  async start() {
    const id = randomBytes(18).toString('hex');
    const ttlMs = this.ttlMs();
    const session: Session = { id, expiresAt: Date.now() + ttlMs };
    await this.save(session);
    return {
      session,
      cookie: `${this.cookieName()}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}`,
    };
  }

  async save(session: Session) {
    await this.sessions.save(
      this.sessions.create({
        id: session.id,
        expiresAt: new Date(session.expiresAt),
        state: session.oauth?.state || '',
        nonce: session.oauth?.nonce || '',
        oauthExpiresAt: session.oauth ? new Date(session.oauth.expiresAt) : null,
        linkPayerId: session.oauth?.linkPayerId || '',
      }),
    );
  }

  private toSession(row: OauthSessionEntity): Session {
    const session: Session = { id: row.id, expiresAt: row.expiresAt.getTime() };
    if (row.state) {
      session.oauth = {
        state: row.state,
        nonce: row.nonce,
        expiresAt: row.oauthExpiresAt?.getTime() || 0,
        linkPayerId: row.linkPayerId || '',
      };
    }
    return session;
  }

  private cookieValue(cookieHeader: string) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === this.cookieName()) return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return '';
  }
}
