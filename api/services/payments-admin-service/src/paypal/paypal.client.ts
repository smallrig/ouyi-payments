import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayPalError } from '../common/paypal.error';
import { AccountService } from '../account/account.service';
import { PayPalAccountEntity } from '../entities/paypal-account.entity';

/** config() 返回值的类型别名，供内部 requestToken / fetchUserInfo 等复用。 */
type PaypalConfig = ReturnType<PaypalClient['config']>;

/** 卖家侧 Disputes API 允许的 POST action（含少见操作）。 */
export const DISPUTE_ACTIONS = [
  'provide-evidence',
  'send-message',
  'make-offer',
  'accept-claim',
  'escalate',
  'appeal',
  'acknowledge-return-item',
  'provide-supporting-info',
] as const;

export type DisputeAction = (typeof DISPUTE_ACTIONS)[number];

/**
 * PayPal REST 访问的唯一出口（OAuth、交易、订单、争议）。
 *
 * 令牌策略：
 * - 商家业务（交易 / 订单 / 争议）：用该商家授权时拿到的 refresh_token 换 access_token，
 *   不用应用级 client_credentials（client_credentials 看不到商家自己的账本）。
 * - 平台级 token 字段（platformToken / platformFlight）预留，当前主流程未使用。
 *
 * 并发控制：
 * - merchantFlights：同一 payerId 刷新令牌时合并为一次请求，避免并发打爆 refresh。
 */
@Injectable()
export class PaypalClient {
  /** 应用级（client_credentials）访问令牌缓存；当前业务主路径未走此通道。 */
  private platformToken: { accessToken: string; expiresAt: number } | null = null;
  /** 平台令牌正在刷新时的 in-flight Promise，防止并发重复申请。 */
  private platformFlight: Promise<{ accessToken: string; expiresAt: number }> | null = null;
  /**
   * 商家令牌刷新中的 Promise 表，key = payerId。
   * ensureMerchantToken 命中未过期 access_token 直接返回；否则共用同一次 refresh。
   */
  private merchantFlights = new Map<string, Promise<PayPalAccountEntity>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly accounts: AccountService,
  ) {}

  // ─── 配置读取 ─────────────────────────────────────────────

  /** 必填字符串环境变量；空则抛 500，提示缺哪一项。缺省值只放在 .env，这里不写死。 */
  private required(key: string) {
    const value = String(this.configService.get(key) ?? '').trim();
    if (!value) throw new PayPalError(`缺少环境变量 ${key}`, { status: 500 });
    return value;
  }

  /** 必填正数环境变量（超时、页大小、TTL 等）。 */
  private requiredNumber(key: string) {
    const value = Number(this.required(key));
    if (!Number.isFinite(value) || value <= 0) {
      throw new PayPalError(`环境变量 ${key} 必须是正数`, { status: 500 });
    }
    return value;
  }

  /**
   * 每次调用都重新读环境变量，改 .env 并重启进程后生效。
   * PAYPAL_ENV=live|sandbox 决定 apiBase / webBase 走 LIVE 还是 SANDBOX 那一组。
   */
  config() {
    const envName = this.required('PAYPAL_ENV').toLowerCase();
    const live = envName === 'live';
    return {
      envName,
      /** REST API 根，如 https://api-m.paypal.com */
      apiBase: this.required(live ? 'PAYPAL_API_BASE_LIVE' : 'PAYPAL_API_BASE_SANDBOX'),
      /** 授权页根，如 https://www.paypal.com */
      webBase: this.required(live ? 'PAYPAL_WEB_BASE_LIVE' : 'PAYPAL_WEB_BASE_SANDBOX'),
      clientId: String(this.configService.get('PAYPAL_CLIENT_ID') || '').trim(),
      clientSecret: String(this.configService.get('PAYPAL_CLIENT_SECRET') || '').trim(),
      /** 须与 Developer Dashboard「Log in with PayPal」Return URL 完全一致 */
      redirectUri: this.required('PAYPAL_REDIRECT_URI'),
      /** 空格分隔的 OAuth scope 列表 */
      scopes: this.required('PAYPAL_SCOPES').split(/\s+/).filter(Boolean),
      /** connect = /connect；legacy = /signin/authorize */
      authorizeStyle: this.required('PAYPAL_AUTHORIZE_STYLE').toLowerCase(),
      authorizePath: this.required('PAYPAL_AUTHORIZE_PATH'),
      legacyAuthorizePath: this.required('PAYPAL_LEGACY_AUTHORIZE_PATH'),
      /** connect 流程的 flowEntry，通常为 static */
      authorizeFlowEntry: this.required('PAYPAL_AUTHORIZE_FLOW_ENTRY'),
      oauthTokenPath: this.required('PAYPAL_OAUTH_TOKEN_PATH'),
      userinfoPath: this.required('PAYPAL_USERINFO_PATH'),
      userinfoSchema: this.required('PAYPAL_USERINFO_SCHEMA'),
      transactionsPath: this.required('PAYPAL_TRANSACTIONS_PATH'),
      transactionFields: this.required('PAYPAL_TRANSACTION_FIELDS'),
      transactionPageSize: String(this.requiredNumber('PAYPAL_TRANSACTION_PAGE_SIZE')),
      transactionPage: this.required('PAYPAL_TRANSACTION_PAGE'),
      transactionBalanceOnly: this.required('PAYPAL_TRANSACTION_BALANCE_ONLY'),
      /** 单次查询最大跨度（天），PayPal Reporting 有上限 */
      transactionMaxDays: this.requiredNumber('PAYPAL_TRANSACTION_MAX_DAYS'),
      ordersPath: this.required('PAYPAL_ORDERS_PATH'),
      disputesPath: this.required('PAYPAL_DISPUTES_PATH'),
      disputePageSize: String(this.requiredNumber('PAYPAL_DISPUTE_PAGE_SIZE')),
      /** listDisputes 跟 next 链接时的最大页数，防异常链接打满配额 */
      disputeMaxPages: this.requiredNumber('PAYPAL_DISPUTE_MAX_PAGES'),
      /** multipart 证据文件字段名，官方为 evidence-file */
      evidenceFileField: this.required('PAYPAL_EVIDENCE_FILE_FIELD'),
      /** 允许透传的 API 路径前缀白名单，如 /v1/,/v2/ */
      apiPrefixes: this.required('PAYPAL_API_PREFIXES').split(',').map((item) => item.trim()).filter(Boolean),
      partnerAttributionId: String(this.configService.get('PAYPAL_PARTNER_ATTRIBUTION_ID') || '').trim(),
      frontendUrl: this.required('FRONTEND_URL').replace(/\/$/, ''),
      /** 用订单号回查本系统商品图的内网基址 */
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
      /** access_token 过期前多少毫秒视为需要刷新，避免边界时刻 401 */
      tokenRefreshSkewMs: this.requiredNumber('PAYPAL_TOKEN_REFRESH_SKEW_MS'),
      oauthSessionTtlMs: this.requiredNumber('OAUTH_SESSION_TTL_SEC') * 1000,
      oauthStateTtlMs: this.requiredNumber('OAUTH_STATE_TTL_SEC') * 1000,
      evidenceMaxFiles: this.requiredNumber('EVIDENCE_MAX_FILES'),
      evidenceMaxFileBytes: this.requiredNumber('EVIDENCE_MAX_FILE_BYTES'),
      evidenceMaxTotalBytes: this.requiredNumber('EVIDENCE_MAX_TOTAL_BYTES'),
    };
  }

  /** 启动授权 / 换码前校验 App 凭证是否已配置。 */
  assertCredentials(config = this.config()) {
    if (!config.clientId || !config.clientSecret) {
      throw new PayPalError('缺少 PAYPAL_CLIENT_ID 或 PAYPAL_CLIENT_SECRET', { status: 400 });
    }
    return config;
  }

  // ─── OAuth 授权 ───────────────────────────────────────────

  /**
   * 拼装商家「Log in with PayPal」授权页 URL。
   * - connect：webBase + /connect?flowEntry=…&client_id=…
   * - legacy：webBase + /signin/authorize?…
   * state / nonce 由调用方生成并写入 OAuth 会话，回调时核对防 CSRF。
   */
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

  /** 校验 Checkout Order ID 形态（大写字母数字，最长 36）。 */
  assertOrderId(orderId: string) {
    const id = String(orderId || '').trim();
    if (!/^[A-Z0-9]{1,36}$/.test(id)) {
      throw new PayPalError('Order ID 只允许 1 到 36 位大写字母和数字。', { status: 400 });
    }
    return id;
  }

  /**
   * 授权回调：用 code 换 token → 拉 userinfo → 落库商家账号。
   *
   * @param code 授权码（一次性）
   * @param linkPayerId 重新授权时可选；userinfo 若缺 payer_id 则用此回绑原账号
   *
   * 注意：必须拿到 refresh_token（scope 需含 openid），否则后续无法静默刷新。
   */
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
      // userinfo 失败不直接中断：若有 linkPayerId 仍可回绑；否则下面会因缺 payerId 报错
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
      // 已有非 pending 状态则保留（如 frozen）；否则标为 active
      status: existing.status && existing.status !== 'pending' ? existing.status : 'active',
      obtainedAt: existing.obtainedAt || new Date(),
      refreshedAt: existing.obtainedAt ? new Date() : null,
    });
    return { record: saved, profileError };
  }

  // ─── 交易 / 订单 ──────────────────────────────────────────

  /**
   * 拉取商家近 N 天交易（Reporting Transactions API）。
   * 使用商家 access_token；days 受 transactionMaxDays 上限约束。
   */
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

  /** GET /v2/checkout/orders/{id}，需商家已授权且对该订单有可见性。 */
  async fetchOrder(payerId: string, orderId: string) {
    const merchant = await this.ensureMerchantToken(payerId);
    const config = this.config();
    return this.callPayPal(config, {
      method: 'GET',
      path: `${config.ordersPath}/${orderId}`,
      token: merchant.accessToken,
    });
  }

  // ─── 争议 ─────────────────────────────────────────────────

  /**
   * 列出商家争议摘要。
   * 跟随 HATEOAS `links[].rel=next` 翻页，最多 disputeMaxPages 页，避免异常链接打满配额。
   */
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

  /** GET /v1/customer/disputes/{id}，含阶段、截止时间、消息与证据清单。 */
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
   * 提交争议证据（可带附件）。
   * PayPal 要求 multipart/form-data：
   * - 字段 `input`：JSON（证据说明、类型等）
   * - 文件字段名：默认 `evidence-file`（EVIDENCE 配置）
   * 支持 JPG / PNG / GIF / PDF；超时用 evidenceTimeoutMs（通常大于普通 HTTP 超时）。
   */
  async provideEvidence(
    payerId: string,
    disputeId: string,
    input: Record<string, unknown>,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ) {
    return this.postDisputeMultipart(payerId, disputeId, 'provide-evidence', input, files);
  }

  /**
   * 给买家发消息，可选附件。
   * PayPal 约束：JPG / PNG / GIF / PDF，单文件约 10MB；仅当详情 links 含 send-message（多为 INQUIRY）。
   * multipart 字段：`input` = { message }，文件字段默认 `file`（PAYPAL_MESSAGE_FILE_FIELD）。
   */
  async sendDisputeMessage(
    payerId: string,
    disputeId: string,
    input: Record<string, unknown>,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ) {
    if (!files.length) {
      return this.actOnDispute(payerId, disputeId, 'send-message', input);
    }
    const field = String(this.configService.get('PAYPAL_MESSAGE_FILE_FIELD') || 'file').trim() || 'file';
    return this.postDisputeMultipart(payerId, disputeId, 'send-message', input, files, field);
  }

  /**
   * 补充说明（provide-supporting-info）。可带附件，约束同 send-message。
   */
  async provideSupportingInfo(
    payerId: string,
    disputeId: string,
    input: Record<string, unknown>,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
  ) {
    if (!files.length) {
      return this.actOnDispute(payerId, disputeId, 'provide-supporting-info', input);
    }
    return this.postDisputeMultipart(payerId, disputeId, 'provide-supporting-info', input, files);
  }

  /**
   * 争议 multipart POST（证据 / 留言 / 补充说明共用）。
   * 不要手动设 Content-Type，由运行时带 boundary。
   */
  private async postDisputeMultipart(
    payerId: string,
    disputeId: string,
    action: DisputeAction,
    input: Record<string, unknown>,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>,
    fileField?: string,
  ) {
    const config = this.config();
    const merchant = await this.ensureMerchantToken(payerId);
    const form = new FormData();
    form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
    const field = fileField || config.evidenceFileField;
    for (const file of files) {
      form.append(
        field,
        new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'application/octet-stream' }),
        this.safeFileName(file.originalname),
      );
    }
    const url = new URL(`${config.disputesPath}/${encodeURIComponent(disputeId)}/${action}`, config.apiBase);
    const response = await this.paypalFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${merchant.accessToken}`,
        Accept: 'application/json',
      },
      body: form,
      signal: AbortSignal.timeout(config.evidenceTimeoutMs),
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

  /**
   * 校验 PayPal Webhook 签名。
   * 需配置 PAYPAL_WEBHOOK_ID（Dashboard 里该 webhook 的 id）。
   * 未配置时返回 skipped，由调用方决定是否放行。
   */
  async verifyWebhookSignature(headers: Record<string, string>, event: unknown) {
    const webhookId = String(this.configService.get('PAYPAL_WEBHOOK_ID') || '').trim();
    if (!webhookId) return { ok: true, skipped: true, status: 'SKIPPED' };
    const authAlgo = headers['paypal-auth-algo'] || '';
    const certUrl = headers['paypal-cert-url'] || '';
    const transmissionId = headers['paypal-transmission-id'] || '';
    const transmissionSig = headers['paypal-transmission-sig'] || '';
    const transmissionTime = headers['paypal-transmission-time'] || '';
    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      throw new PayPalError('Webhook 缺少 PayPal 签名头', { status: 400 });
    }
    const token = await this.ensurePlatformToken();
    const config = this.assertCredentials();
    const path = String(
      this.configService.get('PAYPAL_WEBHOOK_VERIFY_PATH') || '/v1/notifications/verify-webhook-signature',
    ).trim();
    const result = await this.callPayPal(config, {
      method: 'POST',
      path,
      token: token.accessToken,
      body: {
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      },
    });
    const status = String(result.body?.verification_status || '').toUpperCase();
    if (status !== 'SUCCESS') {
      throw new PayPalError(`Webhook 签名校验失败（${status || 'UNKNOWN'}）`, {
        status: 400,
        body: result.body,
        debugId: result.debugId,
      });
    }
    return { ok: true, skipped: false, status };
  }

  /**
   * POST /v1/customer/disputes/{id}/{action}。
   * action 白名单与争议解决中心操作对齐，防止任意路径注入。
   */
  async actOnDispute(payerId: string, disputeId: string, action: string, body: Record<string, unknown>) {
    if (!(DISPUTE_ACTIONS as readonly string[]).includes(action)) {
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

  // ─── 商家 / 平台令牌 ──────────────────────────────────────

  /**
   * 平台级 client_credentials 令牌（Webhook 验签等，不代替商家 token）。
   */
  private async ensurePlatformToken() {
    const config = this.assertCredentials();
    if (this.platformToken && this.platformToken.expiresAt - Date.now() > config.tokenRefreshSkewMs) {
      return this.platformToken;
    }
    if (!this.platformFlight) {
      this.platformFlight = this.requestToken(config, { grant_type: 'client_credentials' })
        .then((token) => {
          const expiresIn = Number(token.expires_in);
          this.platformToken = {
            accessToken: String(token.access_token || ''),
            expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
          };
          return this.platformToken;
        })
        .finally(() => {
          this.platformFlight = null;
        });
    }
    return this.platformFlight;
  }

  /**
   * 保证拿到可用的商家 access_token。
   * 1) 库中有未过期 token（减去 skew）→ 直接返回
   * 2) 否则 refresh_token 换新令牌并 upsert；同 payerId 并发共用 merchantFlights
   */
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

  /** 用 refresh_token 换新 access_token，并写回账号表（保留旧 refresh 若响应未返回新的）。 */
  private async refreshMerchant(saved: PayPalAccountEntity) {
    const token = await this.requestToken(this.assertCredentials(), {
      grant_type: 'refresh_token',
      refresh_token: saved.refreshToken,
    });
    const fields = this.tokenFields(token, saved);
    return this.accounts.upsert({ ...saved, ...fields, payerId: saved.payerId });
  }

  // ─── 纯工具 ───────────────────────────────────────────────

  /** 计算 Reporting 查询的 UTC 起止（ISO8601，无毫秒），天数夹在 [1, maxDays]。 */
  private paypalRange(days: number | undefined, maxDays: number) {
    const span = Math.min(maxDays, Math.max(1, Number(days) || maxDays));
    const end = new Date();
    const start = new Date(end.getTime() - span * 24 * 60 * 60 * 1000);
    const stamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return { start_date: stamp(start), end_date: stamp(end), days: span };
  }

  /** 将 OAuth token 响应映射为账号实体字段；refresh_token 缺失时沿用 previous。 */
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

  /** 从 userinfo 抽出 payerId / email / 显示名（兼容 string name 与 given_name+surname）。 */
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

  /** 附件文件名清洗：去掉路径分隔符与危险字符，保留中文，限制长度。 */
  private safeFileName(name: string) {
    const base = String(name || 'evidence').split(/[/\\]/).pop() || 'evidence';
    return base.replace(/[^\w.\-()\u4e00-\u9fff ]+/g, '_').slice(0, 120);
  }

  /** application/x-www-form-urlencoded 编码（跳过空值）。 */
  private encodeForm(params: Record<string, string>) {
    return Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  }

  // ─── HTTP ─────────────────────────────────────────────────

  /**
   * 带统一错误映射的 fetch。
   * 超时 / Abort → 504；其它网络错误 → 502（附 cause 便于排查）。
   */
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

  /**
   * OAuth2 /v1/oauth2/token：Basic(clientId:secret) + form body。
   * 用于 authorization_code 与 refresh_token 两种 grant。
   */
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

  /** GET identity userinfo（schema 如 paypalv1.1），用于拿到 payer_id / email。 */
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

  /**
   * 通用 PayPal REST 调用（JSON）。
   * path 必须以 apiPrefixes 中某一前缀开头，防止任意 URL 透传。
   * 成功返回 { body, debugId }；失败抛 PayPalError（带 paypal-debug-id）。
   */
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

  /** 读响应体：优先 JSON，失败则包成 { raw }；并提取 paypal-debug-id。 */
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

  /**
   * 把 PayPal 错误体整理成可读中文/原文。
   * 对「insufficient permissions」给出重新授权提示（常见于缺争议 scope）。
   */
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
