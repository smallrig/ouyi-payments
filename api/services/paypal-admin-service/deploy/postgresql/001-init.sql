-- PayPal 多账号管理库（yxshop_paypal）
CREATE TABLE IF NOT EXISTS pp_account (
  payer_id         varchar(32) PRIMARY KEY,
  email            varchar(320) NOT NULL DEFAULT '',
  name             varchar(200) NOT NULL DEFAULT '',
  status           varchar(16)  NOT NULL DEFAULT 'pending',
  balance          numeric(18, 2),
  frozen_amount    numeric(18, 2) NOT NULL DEFAULT 0,
  owner_user_id    varchar(64)  NOT NULL DEFAULT '',
  owner_name       varchar(120) NOT NULL DEFAULT '',
  refresh_token    text         NOT NULL DEFAULT '',
  access_token     text         NOT NULL DEFAULT '',
  token_type       varchar(32)  NOT NULL DEFAULT 'Bearer',
  expires_at       bigint       NOT NULL DEFAULT 0,
  scope            text         NOT NULL DEFAULT '',
  last_synced_at   timestamptz,
  note             text         NOT NULL DEFAULT '',
  obtained_at      timestamptz,
  refreshed_at     timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT NOW(),
  updated_at       timestamptz  NOT NULL DEFAULT NOW(),
  CONSTRAINT pp_account_status_chk CHECK (status IN ('active', 'frozen', 'pending'))
);

CREATE INDEX IF NOT EXISTS idx_pp_account_owner ON pp_account (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_pp_account_status ON pp_account (status);

CREATE TABLE IF NOT EXISTS pp_transaction_cache (
  payer_id   varchar(32) PRIMARY KEY REFERENCES pp_account (payer_id) ON DELETE CASCADE,
  synced_at  timestamptz,
  range      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  items      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pp_webhook_event (
  id           varchar(32) PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT NOW(),
  headers      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  event        jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pp_webhook_received ON pp_webhook_event (received_at DESC);

CREATE TABLE IF NOT EXISTS pp_dispute (
  id          varchar(64) PRIMARY KEY,
  payer_id    varchar(32) NOT NULL DEFAULT '',
  status      varchar(32) NOT NULL DEFAULT '',
  reason      varchar(80) NOT NULL DEFAULT '',
  amount      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz,
  raw         jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pp_dispute_status ON pp_dispute (status);

CREATE TABLE IF NOT EXISTS pp_api_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT NOW(),
  method    varchar(12) NOT NULL DEFAULT '',
  path      text        NOT NULL DEFAULT '',
  status    int         NOT NULL DEFAULT 0,
  user_id   varchar(64) NOT NULL DEFAULT '',
  payer_id  varchar(32) NOT NULL DEFAULT '',
  debug_id  varchar(64) NOT NULL DEFAULT '',
  message   text        NOT NULL DEFAULT '',
  ms        int         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pp_api_log_at ON pp_api_log (at DESC);

COMMENT ON TABLE pp_account IS 'PayPal 商家账号';
COMMENT ON COLUMN pp_account.payer_id IS 'PayPal 商家编号（payer_id）';
COMMENT ON COLUMN pp_account.email IS '商家邮箱';
COMMENT ON COLUMN pp_account.name IS '商家显示名称';
COMMENT ON COLUMN pp_account.status IS '账号状态：active 正常，frozen 冻结，pending 待授权';
COMMENT ON COLUMN pp_account.balance IS '账面余额，未同步时为空';
COMMENT ON COLUMN pp_account.frozen_amount IS '冻结金额';
COMMENT ON COLUMN pp_account.owner_user_id IS '负责人用户编号，空表示尚未分配';
COMMENT ON COLUMN pp_account.owner_name IS '负责人姓名';
COMMENT ON COLUMN pp_account.refresh_token IS 'OAuth 刷新令牌，解除授权后清空';
COMMENT ON COLUMN pp_account.access_token IS '当前访问令牌，过期后用刷新令牌更换';
COMMENT ON COLUMN pp_account.token_type IS '令牌类型，一般为 Bearer';
COMMENT ON COLUMN pp_account.expires_at IS '访问令牌过期时间，Unix 毫秒时间戳';
COMMENT ON COLUMN pp_account.scope IS '授权时 PayPal 授予的权限范围';
COMMENT ON COLUMN pp_account.last_synced_at IS '最近一次同步交易的时间';
COMMENT ON COLUMN pp_account.note IS '后台备注';
COMMENT ON COLUMN pp_account.obtained_at IS '首次授权成功时间';
COMMENT ON COLUMN pp_account.refreshed_at IS '最近一次刷新令牌的时间';
COMMENT ON COLUMN pp_account.created_at IS '创建时间';
COMMENT ON COLUMN pp_account.updated_at IS '更新时间';

COMMENT ON TABLE pp_transaction_cache IS 'PayPal 交易流水缓存';
COMMENT ON COLUMN pp_transaction_cache.payer_id IS '商家编号，对应 pp_account.payer_id';
COMMENT ON COLUMN pp_transaction_cache.synced_at IS '本次缓存从 PayPal 拉回的时间';
COMMENT ON COLUMN pp_transaction_cache.range IS '同步区间，含 start_date、end_date、days';
COMMENT ON COLUMN pp_transaction_cache.items IS '交易明细数组，对应 transaction_details';
COMMENT ON COLUMN pp_transaction_cache.updated_at IS '缓存写入时间';

COMMENT ON TABLE pp_webhook_event IS 'PayPal Webhook 事件';
COMMENT ON COLUMN pp_webhook_event.id IS '本地事件编号';
COMMENT ON COLUMN pp_webhook_event.received_at IS '本服务收到事件的时间';
COMMENT ON COLUMN pp_webhook_event.headers IS 'PayPal 回调头，含 transmission id 与 time';
COMMENT ON COLUMN pp_webhook_event.event IS '事件正文，含 event_type 与 resource';

COMMENT ON TABLE pp_dispute IS 'PayPal 争议案件';
COMMENT ON COLUMN pp_dispute.id IS 'PayPal 争议编号（dispute_id）';
COMMENT ON COLUMN pp_dispute.payer_id IS '所属商家编号，对应 pp_account.payer_id';
COMMENT ON COLUMN pp_dispute.status IS '争议状态，如 OPEN、UNDER_REVIEW、RESOLVED';
COMMENT ON COLUMN pp_dispute.reason IS '买家发起原因，如未收到商品、商品与描述不符';
COMMENT ON COLUMN pp_dispute.amount IS '争议金额，含 currency_code 与 value';
COMMENT ON COLUMN pp_dispute.created_at IS '争议创建时间';
COMMENT ON COLUMN pp_dispute.raw IS 'PayPal 原始争议对象，含阶段、截止时间、消息、证据与可执行操作';

COMMENT ON TABLE pp_api_log IS 'PayPal 接口调用日志';
COMMENT ON COLUMN pp_api_log.id IS '日志编号';
COMMENT ON COLUMN pp_api_log.at IS '发生时间';
COMMENT ON COLUMN pp_api_log.method IS 'HTTP 方法';
COMMENT ON COLUMN pp_api_log.path IS '请求路径';
COMMENT ON COLUMN pp_api_log.status IS 'HTTP 状态码';
COMMENT ON COLUMN pp_api_log.user_id IS '操作人用户编号';
COMMENT ON COLUMN pp_api_log.payer_id IS '涉及的商家编号，没有则为空';
COMMENT ON COLUMN pp_api_log.debug_id IS 'PayPal 返回的 paypal-debug-id';
COMMENT ON COLUMN pp_api_log.message IS '结果说明，最长保留 500 字';
COMMENT ON COLUMN pp_api_log.ms IS '耗时，毫秒';

CREATE TABLE IF NOT EXISTS pp_product_image (
  cache_kind varchar(16)  NOT NULL,
  cache_key  varchar(300) NOT NULL,
  image_url  text         NOT NULL DEFAULT '',
  updated_at timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cache_kind, cache_key)
);

CREATE TABLE IF NOT EXISTS pp_oauth_session (
  id               varchar(64) PRIMARY KEY,
  expires_at       timestamptz NOT NULL,
  state            varchar(64) NOT NULL DEFAULT '',
  nonce            varchar(64) NOT NULL DEFAULT '',
  oauth_expires_at timestamptz,
  link_payer_id    varchar(32) NOT NULL DEFAULT ''
);

COMMENT ON TABLE pp_product_image IS '商品图片缓存';
COMMENT ON COLUMN pp_product_image.cache_kind IS '匹配方式：sku 或 title';
COMMENT ON COLUMN pp_product_image.cache_key IS 'SKU 或规范化后的商品标题';
COMMENT ON COLUMN pp_product_image.image_url IS '商品图片地址';
COMMENT ON COLUMN pp_product_image.updated_at IS '更新时间';

COMMENT ON TABLE pp_oauth_session IS 'PayPal 授权临时会话';
COMMENT ON COLUMN pp_oauth_session.id IS '会话编号，写在 Cookie 里';
COMMENT ON COLUMN pp_oauth_session.expires_at IS '会话过期时间';
COMMENT ON COLUMN pp_oauth_session.state IS 'OAuth state，空表示尚未发起授权';
COMMENT ON COLUMN pp_oauth_session.nonce IS 'OAuth nonce';
COMMENT ON COLUMN pp_oauth_session.oauth_expires_at IS 'state 过期时间';
COMMENT ON COLUMN pp_oauth_session.link_payer_id IS '重新授权时要绑定的商家编号';

CREATE TABLE IF NOT EXISTS pp_transaction (
  payer_id          varchar(32) NOT NULL,
  transaction_id    varchar(32) NOT NULL,
  event_code        varchar(16) NOT NULL DEFAULT '',
  status            varchar(32) NOT NULL DEFAULT '',
  amount_value      numeric(18, 2) NOT NULL DEFAULT 0,
  currency_code     varchar(8)  NOT NULL DEFAULT '',
  buyer_email       varchar(320) NOT NULL DEFAULT '',
  subject           varchar(512) NOT NULL DEFAULT '',
  invoice_id        varchar(127) NOT NULL DEFAULT '',
  custom_field      varchar(256) NOT NULL DEFAULT '',
  initiated_at      timestamptz,
  paypal_updated_at timestamptz,
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (payer_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_pp_transaction_initiated ON pp_transaction (initiated_at DESC);

CREATE TABLE IF NOT EXISTS pp_dispute_event (
  id             varchar(96) PRIMARY KEY,
  dispute_id     varchar(64) NOT NULL,
  payer_id       varchar(32) NOT NULL DEFAULT '',
  kind           varchar(16) NOT NULL DEFAULT '',
  occurred_at    timestamptz,
  author         varchar(64) NOT NULL DEFAULT '',
  content        text        NOT NULL DEFAULT '',
  evidence_type  varchar(64) NOT NULL DEFAULT '',
  raw            jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pp_dispute_event_dispute ON pp_dispute_event (dispute_id);

COMMENT ON TABLE pp_transaction IS 'PayPal 交易记录';
COMMENT ON COLUMN pp_transaction.payer_id IS '商家编号，对应 pp_account.payer_id';
COMMENT ON COLUMN pp_transaction.transaction_id IS 'PayPal 交易号';
COMMENT ON COLUMN pp_transaction.event_code IS '交易事件码，如 T0006';
COMMENT ON COLUMN pp_transaction.status IS '交易状态，如 S 成功';
COMMENT ON COLUMN pp_transaction.amount_value IS '交易金额';
COMMENT ON COLUMN pp_transaction.currency_code IS '币种';
COMMENT ON COLUMN pp_transaction.buyer_email IS '买家邮箱';
COMMENT ON COLUMN pp_transaction.subject IS '交易标题或商品说明';
COMMENT ON COLUMN pp_transaction.invoice_id IS '发票号';
COMMENT ON COLUMN pp_transaction.custom_field IS '自定义字段，通常是订单号';
COMMENT ON COLUMN pp_transaction.initiated_at IS '交易发生时间';
COMMENT ON COLUMN pp_transaction.paypal_updated_at IS 'PayPal 侧更新时间';
COMMENT ON COLUMN pp_transaction.raw IS 'PayPal 返回的完整交易对象';

COMMENT ON TABLE pp_dispute_event IS '争议案件事件';
COMMENT ON COLUMN pp_dispute_event.id IS '事件编号，由案件号、类型和序号组成';
COMMENT ON COLUMN pp_dispute_event.dispute_id IS '所属争议编号，对应 pp_dispute.id';
COMMENT ON COLUMN pp_dispute_event.payer_id IS '所属商家编号';
COMMENT ON COLUMN pp_dispute_event.kind IS '事件类型：message 留言，evidence 证据';
COMMENT ON COLUMN pp_dispute_event.occurred_at IS '事件发生时间';
COMMENT ON COLUMN pp_dispute_event.author IS '提交方，如 BUYER、SELLER、PAYPAL';
COMMENT ON COLUMN pp_dispute_event.content IS '留言内容或证据说明';
COMMENT ON COLUMN pp_dispute_event.evidence_type IS '证据类型，留言为空';
COMMENT ON COLUMN pp_dispute_event.raw IS 'PayPal 返回的原始事件对象';
