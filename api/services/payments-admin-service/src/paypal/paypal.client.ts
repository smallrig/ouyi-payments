import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayPalError } from '../common/paypal.error';
import { AccountService } from '../account/account.service';
import { PayPalAccountEntity } from '../entities/paypal-account.entity';

type PaypalConfig = ReturnType<PaypalClient['config']>;

/**
 * 访问 PayPal 的唯一出口。
 * 交易和争议都用商家自己的 refresh_token 换访问令牌，不用应用级 client_credentials。
 */
@Injectable()
export class PaypalClient {
  private platformToken: { accessToken: string; expiresAt: number } | null = null;
  private platformFlight: Promise<{ accessToken: string; expiresAt: number }> | null = null;
  private merchantFlights = new Map<string, Promise<PayPalAccountEntity>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly accounts: AccountService,
  ) {}

  /** 缺省值只放在 .env。这里读不到就直接报缺少哪一项。 */
  private required(key: string) {
    const value = String(this.configService.get(key) ?? '').trim();
    if (!value) throw new PayPalError(`缺少环境变量 ${key}`, { status: 500 });
    return value;
  }

  private requiredNumber(key: string) {
    const value = Number(this.required(key));
    if (!Number.isFinite(value) || value <= 0) {
      throw new PayPalError(`环境变量 ${key} 必须是正数`, { status: 500 });
    }
    return value;
  }

  /** 每次从环境变量读取，改 .env 并重启后生效。 */
  config() {
    const envName = this.required('PAYPAL_ENV').toLowerCase();
    const live = envName === 'live';
    return {
      envName,
      apiBase: this.required(live ? 'PAYPAL_API_BASE_LIVE' : 'PAYPAL_API_BASE_SANDBOX'),
      webBase: this.required(live ? 'PAYPAL_WEB_BASE_LIVE' : 'PAYPAL_WEB_BASE_SANDBOX'),
      clientId: String(this.configService.get('PAYPAL_CLIENT_ID') || '').trim(),
      clientSecret: String(this.configService.get('PAYPAL_CLIENT_SECRET') || '').trim(),
      redirectUri: this.required('PAYPAL_REDIRECT_URI'),
      scopes: this.required('PAYPAL_SCOPES').split(/\s+/).filter(Boolean),
      authorizeStyle: this.required('PAYPAL_AUTHORIZE_STYLE').toLowerCase(),
      authorizePath: this.required('PAYPAL_AUTHORIZE_PATH'),
      legacyAuthorizePath: this.required('PAYPAL_LEGACY_AUTHORIZE_PATH'),
      authorizeFlowEntry: this.required('PAYPAL_AUTHORIZE_FLOW_ENTRY'),
      oauthTokenPath: this.required('PAYPAL_OAUTH_TOKEN_PATH'),
      userinfoPath: this.required('PAYPAL_USERINFO_PATH'),
      userinfoSchema: this.required('PAYPAL_USERINFO_SCHEMA'),
      transactionsPath: this.required('PAYPAL_TRANSACTIONS_PATH'),
      transactionFields: this.required('PAYPAL_TRANSACTION_FIELDS'),
      transactionPageSize: String(this.requiredNumber('PAYPAL_TRANSACTION_PAGE_SIZE')),
      transactionPage: this.required('PAYPAL_TRANSACTION_PAGE'),
      transactionBalanceOnly: this.required('PAYPAL_TRANSACTION_BALANCE_ONLY'),
      transactionMaxDays: this.requiredNumber('PAYPAL_TRANSACTION_MAX_DAYS'),
      ordersPath: this.required('PAYPAL_ORDERS_PATH'),
      disputesPath: this.required('PAYPAL_DISPUTES_PATH'),
      disputePageSize: String(this.requiredNumber('PAYPAL_DISPUTE_PAGE_SIZE')),
      disputeMaxPages: this.requiredNumber('PAYPAL_DISPUTE_MAX_PAGES'),
      evidenceFileField: this.required('PAYPAL_EVIDENCE_FILE_FIELD'),
      apiPrefixes: this.required('PAYPAL_API_PREFIXES').split(',').map((item) => item.trim()).filter(Boolean),
      partnerAttributionId: String(this.configService.get('PAYPAL_PARTNER_ATTRIBUTION_ID') || '').trim(),
      frontendUrl: this.required('FRONTEND_URL').replace(/\/$/, ''),
      orderLookupBase: this.required('ORDER_LOOKUP_BASE').replace(/\/$/, ''),
      authDisabled:
        this.configService.get('AUTH_DISABLED') === 'true' ||
        this.configService.get('AUTH_DISABLED') === '1',
      jwtSecret: String(this.configService.get('JWT_SECRET') || '').trim(),
      corsOrigin: this.required('CORS_ORIGIN'),
      port: this.requiredNumber('PORT'),
      host: this.required('HOST'),
      database: this.required('DB_DATABASE'),
      httpTimeoutMs: this.requiredNumber('PAYPAL_HTTP_TIMEOUT_MS'),
      evidenceTimeoutMs: this.requiredNumber('PAYPAL_EVIDENCE_TIMEOUT_MS'),
      tokenRefreshSkewMs: this.requiredNumber('PAYPAL_TOKEN_REFRESH_SKEW_MS'),
      oauthSessionTtlMs: this.requiredNumber('OAUTH_SESSION_TTL_SEC') * 1000,
      oauthStateTtlMs: this.requiredNumber('OAUTH_STATE_TTL_SEC') * 1000,
      evidenceMaxFiles: this.requiredNumber('EVIDENCE_MAX_FILES'),
      evidenceMaxFileBytes: this.requiredNumber('EVIDENCE_MAX_FILE_BYTES'),
      evidenceMaxTotalBytes: this.requiredNumber('EVIDENCE_MAX_TOTAL_BYTES'),
    };
  }

  assertCredentials(config = this.config()) {
    if (!config.clientId || !config.clientSecret) {
      throw new PayPalError('缺少 PAYPAL_CLIENT_ID 或 PAYPAL_CLIENT_SECRET', { status: 400 });
    }
    return config;
  }

  buildAuthorizeUrl(state: string, nonce: string) {
    const config = this.assertCredentials();
    const query = {
      client_id: config.clientId,
      response_type: 'code',
      scope: config.scopes.join(' '),
      redirect_uri: config.redirectUri,
      state,
      nonce,
    };
    if (config.authorizeStyle === 'legacy') {
      return `${config.webBase}${config.legacyAuthorizePath}?${this.encodeForm(query)}`;
    }
    return `${config.webBase}${config.authorizePath}?${this.encodeForm({ flowEntry: config.authorizeFlowEntry, ...query })}`;
  }

  assertOrderId(orderId: string) {
    const id = String(orderId || '').trim();
    if (!/^[A-Z0-9]{1,36}$/.test(id)) {
      throw new PayPalError('Order ID 只允许 1 到 36 位大写字母和数字。', { status: 400 });
    }
    return id;
  }

  /** 用授权码换令牌并落库。linkPayerId 用于 userinfo 拿不到 payer_id 时回绑原账号。 */
  async exchangeAuthorizationCode(code: string, linkPayerId = '') {
    const config = this.assertCredentials();
    const token = await this.requestToken(config, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    });
    let profile: any = {};
    let profileError = '';
    try {
      profile = await this.fetchUserInfo(config, token.access_token);
    } catch (error) {
      profileError = error instanceof Error ? error.message : '';
    }
    const summary = this.profileSummary(profile);
    const payerId = summary.payerId || linkPayerId;
    if (!payerId) {
      throw new PayPalError('无法从 userinfo 取得 payer_id，请确认 scope 包含 openid。', {
        status: 502,
        body: { profileError },
      });
    }
    const existing = (await this.accounts.findOne(payerId)) || ({} as PayPalAccountEntity);
    const fields = this.tokenFields(token, { ...existing, ...summary, payerId });
    if (!fields.refreshToken) {
      throw new PayPalError('PayPal 没有返回 refresh_token。确认 scope 包含 openid。', {
        status: 502,
        body: { scope: token.scope || '' },
      });
    }
    const saved = await this.accounts.upsert({
      ...existing,
      ...fields,
      ...summary,
      payerId,
      status: existing.status && existing.status !== 'pending' ? existing.status : 'active',
      obtainedAt: existing.obtainedAt || new Date(),
      refreshedAt: existing.obtainedAt ? new Date() : null,
    });
    return { record: saved, profileError };
  }

  async searchTransactions(payerId: string, days?: number) {
    const config = this.config();
    const merchant = await this.ensureMerchantToken(payerId);
    const range = this.paypalRange(days, config.transactionMaxDays);
    const result = await this.callPayPal(config, {
      method: 'GET',
      path: config.transactionsPath,
      query: {
        start_date: range.start_date,
        end_date: range.end_date,
        fields: config.transactionFields,
        page_size: config.transactionPageSize,
        page: config.transactionPage,
        balance_affecting_records_only: config.transactionBalanceOnly,
      },
      token: merchant.accessToken,
    });
    return { range, ...result };
  }

  async fetchOrder(payerId: string, orderId: string) {
    const merchant = await this.ensureMerchantToken(payerId);
    const config = this.config();
    return this.callPayPal(config, {
      method: 'GET',
      path: `${config.ordersPath}/${orderId}`,
      token: merchant.accessToken,
    });
  }

  /** 按 HATEOAS next 分页拉争议摘要，最多 10 页，避免异常链接打满配额。 */
  async listDisputes(payerId: string) {
    const config = this.config();
    const merchant = await this.ensureMerchantToken(payerId);
    const items: any[] = [];
    let path = config.disputesPath;
    let query: Record<string, string> | undefined = { page_size: config.disputePageSize };
    for (let page = 0; page < config.disputeMaxPages; page += 1) {
      const result = await this.callPayPal(config, {
        method: 'GET',
        path,
        query,
        token: merchant.accessToken,
      });
      const batch = Array.isArray(result.body?.items) ? result.body.items : [];
      items.push(...batch);
      const next = (result.body?.links || []).find((link: any) => link.rel === 'next');
      if (!next?.href) break;
      const url = new URL(next.href);
      path = url.pathname;
      query = Object.fromEntries(url.searchParams.entries());
    }
    return items;
  }

  /** GET /v1/customer/disputes/{id}，返回阶段、截止时间、消息和证据。 */
  async getDispute(payerId: string, disputeId: string) {
    const config = this.config();
    const merchant = await this.ensureMerchantToken(payerId);
    const result = await this.callPayPal(config, {
      method: 'GET',
      path: `${config.disputesPath}/${encodeURIComponent(disputeId)}`,
      token: merchant.accessToken,
    });
    return result.body;
  }

  /**
   * 带附件的提交证据。
   * PayPal 要求 multipart/form-data：input 为 JSON，文件字段名 evidence-file。
   * 支持 JPG、PNG、GIF、PDF，单文件小于 10MB。
   */
  async provideEvidence(
    payerId: string,
    disputeId: string,
    input: Record<string, unknown>,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ) {
    const config = this.config();
    const merchant = await this.ensureMerchantToken(payerId);
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    for (const file of files) {
      form.append(
        config.evidenceFileField,
        new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'application/octet-stream' }),
        this.safeFileName(file.originalname),
      );
    }
    const url = new URL(
      `${config.disputesPath}/${encodeURIComponent(disputeId)}/provide-evidence`,
      config.apiBase,
    );
    const response = await this.paypalFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${merchant.accessToken}`,
        Accept: 'application/json',
      },
      body: form,
      signal: AbortSignal.timeout(this.config().evidenceTimeoutMs),
    });
    const result = await this.readBody(response);
    if (!result.ok) {
      throw new PayPalError(this.paypalMessage(result.body, `PayPal API ${result.status}`), {
        status: result.status || 502,
        body: result.body,
        debugId: result.debugId,
      });
    }
    return result.body;
  }

  /** POST /v1/customer/disputes/{id}/{action}。action 白名单与争议解决中心的操作一一对应。 */
  async actOnDispute(payerId: string, disputeId: string, action: string, body: Record<string, unknown>) {
    const allowed = new Set([
      'provide-evidence',
      'send-message',
      'make-offer',
      'accept-claim',
      'escalate',
      'appeal',
    ]);
    if (!allowed.has(action)) {
      throw new PayPalError('不支持的争议操作', { status: 400 });
    }
    const config = this.config();
    const merchant = await this.ensureMerchantToken(payerId);
    const result = await this.callPayPal(config, {
      method: 'POST',
      path: `${config.disputesPath}/${encodeURIComponent(disputeId)}/${action}`,
      token: merchant.accessToken,
      body,
    });
    return result.body;
  }

  /** 令牌仍有效则直接用；否则按商家合并并发刷新，避免同一账号打出多次 refresh。 */
  private async ensureMerchantToken(payerId: string) {
    const id = String(payerId || '').trim();
    if (!id) throw new PayPalError('缺少 payerId', { status: 400 });
    const saved = await this.accounts.findOne(id);
    if (!saved?.refreshToken) {
      throw new PayPalError(`账号 ${id} 尚未授权或 refresh_token 已清除。`, { status: 401 });
    }
    if (saved.accessToken && Number(saved.expiresAt) - Date.now() > this.config().tokenRefreshSkewMs) return saved;
    if (!this.merchantFlights.has(id)) {
      const flight = this.refreshMerchant(saved).finally(() => this.merchantFlights.delete(id));
      this.merchantFlights.set(id, flight);
    }
    return this.merchantFlights.get(id);
  }

  private async refreshMerchant(saved: PayPalAccountEntity) {
    const token = await this.requestToken(this.assertCredentials(), {
      grant_type: 'refresh_token',
      refresh_token: saved.refreshToken,
    });
    const fields = this.tokenFields(token, saved);
    return this.accounts.upsert({ ...saved, ...fields, payerId: saved.payerId });
  }

  private paypalRange(days: number | undefined, maxDays: number) {
    const span = Math.min(maxDays, Math.max(1, Number(days) || maxDays));
    const end = new Date();
    const start = new Date(end.getTime() - span * 24 * 60 * 60 * 1000);
    const stamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return { start_date: stamp(start), end_date: stamp(end), days: span };
  }

  private tokenFields(token: any, previous: Partial<PayPalAccountEntity> = {}) {
    const expiresIn = Number(token.expires_in);
    return {
      accessToken: token.access_token as string,
      refreshToken: token.refresh_token || previous.refreshToken || '',
      tokenType: token.token_type || 'Bearer',
      scope: token.scope || previous.scope || '',
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 0) * 1000,
    };
  }

  private profileSummary(profile: any) {
    const name = profile?.name;
    const display =
      typeof name === 'string'
        ? name
        : [name?.given_name, name?.surname].filter(Boolean).join(' ');
    return {
      payerId: profile?.payer_id || profile?.user_id || '',
      email: profile?.email || profile?.emails?.[0]?.value || '',
      name: display || '',
    };
  }

  private safeFileName(name: string) {
    const base = String(name || 'evidence').split(/[/\\]/).pop() || 'evidence';
    return base.replace(/[^\w.\-()\u4e00-\u9fff ]+/g, '_').slice(0, 120);
  }

  private encodeForm(params: Record<string, string>) {
    return Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  }

  private async paypalFetch(url: string | URL, init: RequestInit) {
    try {
      return await fetch(url, init);
    } catch (error: any) {
      const name = error?.name || '';
      const msg = String(error?.message || '');
      const cause = error?.cause ? String(error.cause.message || error.cause.code || error.cause) : '';
      if (name === 'TimeoutError' || name === 'AbortError' || /aborted|timeout/i.test(msg)) {
        throw new PayPalError('连接 PayPal 超时，请稍后重试', { status: 504, body: { cause } });
      }
      throw new PayPalError(`无法连接 PayPal API${cause ? `（${cause}）` : ''}，请检查网络后重试`, {
        status: 502,
        body: { cause: cause || msg },
      });
    }
  }

  private async requestToken(config: PaypalConfig, params: Record<string, string>) {
    const response = await this.paypalFetch(`${config.apiBase}${config.oauthTokenPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: this.encodeForm(params),
      signal: AbortSignal.timeout(this.config().httpTimeoutMs),
    });
    const result = await this.readBody(response);
    if (!result.ok || !result.body?.access_token) {
      throw new PayPalError(this.paypalMessage(result.body, '换取 access_token 失败'), {
        status: result.status || 502,
        body: result.body,
        debugId: result.debugId,
      });
    }
    return result.body;
  }

  private async fetchUserInfo(config: PaypalConfig, accessToken: string) {
    const response = await this.paypalFetch(
      `${config.apiBase}${config.userinfoPath}?schema=${encodeURIComponent(config.userinfoSchema)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.config().httpTimeoutMs),
      },
    );
    const result = await this.readBody(response);
    if (!result.ok) {
      throw new PayPalError(this.paypalMessage(result.body, '读取商家资料失败'), {
        status: result.status || 502,
        body: result.body,
        debugId: result.debugId,
      });
    }
    return result.body || {};
  }

  private async callPayPal(
    config: PaypalConfig,
    opts: {
      method: string;
      path: string;
      query?: Record<string, string>;
      token: string;
      body?: Record<string, unknown>;
    },
  ) {
    const allowed = config.apiPrefixes.some((prefix) => opts.path.startsWith(prefix));
    if (!allowed) {
      throw new PayPalError(`只允许调用 PayPal ${config.apiPrefixes.join(' 或 ')} API`, { status: 400 });
    }
    const url = new URL(opts.path, config.apiBase);
    for (const [key, value] of Object.entries(opts.query || {})) {
      if (value) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
      Accept: 'application/json',
    };
    let payload: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(opts.body);
    }
    const response = await this.paypalFetch(url, {
      method: opts.method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(this.config().httpTimeoutMs),
    });
    const result = await this.readBody(response);
    if (!result.ok) {
      throw new PayPalError(this.paypalMessage(result.body, `PayPal API ${result.status}`), {
        status: result.status || 502,
        body: result.body,
        debugId: result.debugId,
      });
    }
    return { body: result.body, debugId: result.debugId };
  }

  private async readBody(response: Response) {
    const text = await response.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      debugId: response.headers.get('paypal-debug-id') || '',
    };
  }

  private paypalMessage(body: any, fallback: string) {
    if (!body) return fallback;
    const detail = Array.isArray(body.details)
      ? body.details.map((item) => item.description || item.issue || '').filter(Boolean).join('; ')
      : '';
    const text =
      [body.error_description || body.message || body.error || body.name, detail].filter(Boolean).join(' — ') ||
      fallback;
    if (/insufficient permissions/i.test(text)) {
      return '当前授权没有争议权限。请到账号管理解除授权后重新接入，新授权会带上争议读写权限。';
    }
    return text;
  }
}
