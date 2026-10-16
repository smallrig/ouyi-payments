/** active 正常，frozen 冻结，pending 待授权或已解除授权。 */
export type PayPalAccountStatus = 'active' | 'frozen' | 'pending';

export type PayPalAccount = {
  payerId: string;
  email: string;
  name: string;
  status: PayPalAccountStatus;
  balance: number | null;
  frozenAmount: number;
  ownerUserId: string;
  ownerName: string;
  scope: string;
  lastSyncedAt: string;
  note: string;
  obtainedAt: string;
  refreshedAt: string;
  authorized: boolean;
  expiresAt?: string;
  expiresInSeconds?: number;
  accessTokenExpired?: boolean;
};

export type DashboardStats = {
  accountCount: number;
  authorizedCount: number;
  totalReceived: number;
  totalWithdrawn: number;
  disputeCount: number;
};

export type MoneyAmount = { currency_code?: string; value?: string };

export type TransactionItem = {
  transaction_info?: {
    paypal_account_id?: string;
    transaction_id?: string;
    paypal_reference_id?: string;
    paypal_reference_id_type?: string;
    transaction_event_code?: string;
    transaction_amount?: MoneyAmount;
    fee_amount?: MoneyAmount;
    shipping_amount?: MoneyAmount;
    transaction_status?: string;
    transaction_subject?: string;
    transaction_initiation_date?: string;
    transaction_updated_date?: string;
    invoice_id?: string;
    custom_field?: string;
    protection_eligibility?: string;
    instrument_type?: string;
    instrument_sub_type?: string;
  };
  payer_info?: {
    account_id?: string;
    email_address?: string;
    address_status?: string;
    payer_status?: string;
    payer_name?: { given_name?: string; surname?: string };
    country_code?: string;
  };
  shipping_info?: {
    name?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      country_code?: string;
      postal_code?: string;
    };
  };
  cart_info?: {
    item_details?: Array<{
      item_code?: string;
      item_name?: string;
      item_description?: string;
      item_quantity?: string;
      item_unit_price?: MoneyAmount;
      item_amount?: MoneyAmount;
      total_item_amount?: MoneyAmount;
      invoice_number?: string;
      /** 前端/后端补全后的商品主图 */
      imageUrl?: string | null;
    }>;
  };
};

export type CartImageEnrichItem = {
  key: string;
  item_code?: string;
  item_name?: string;
  imageUrl?: string | null;
  match?: string | null;
};

export type CartImageEnrichResult = {
  orderId?: string | null;
  source?: string | null;
  items: CartImageEnrichItem[];
};

export type TransactionsPayload = {
  syncedAt: string;
  items: TransactionItem[];
  range?: unknown;
};

/** 争议案件。列表来自本地缓存，打开详情时由后端再向 PayPal 拉一次完整对象。 */
export type DisputeItem = {
  /** PayPal dispute_id */
  id: string;
  /** 所属商家 */
  payerId: string;
  /** OPEN、UNDER_REVIEW、RESOLVED 等 */
  status: string;
  /** 买家原因，如 MERCHANDISE_OR_SERVICE_NOT_RECEIVED */
  reason: string;
  amount?: { currency_code?: string; value?: string };
  createdAt: string;
  /** 争议交易号，优先卖家侧 */
  relatedTransactionId?: string;
  buyerEmail?: string;
  /** 卖家必须响应的截止时间 seller_response_due_date */
  deadlineAt?: string;
  /** 生命周期阶段，与 lifeCycleStage 相同，保留给旧页面 */
  caseType?: string;
  timeline?: Array<{ at: string; title: string; done?: boolean }>;
  /** 双方留言，来自 messages */
  notes?: Array<{ at: string; text: string; author?: string }>;
  /** INQUIRY、CHARGEBACK、PRE_ARBITRATION、ARBITRATION */
  lifeCycleStage?: string;
  evidences?: Array<{
    evidence_type?: string;
    notes?: string;
    source?: string;
    documents?: Array<{ name?: string }>;
  }>;
  /** 本地示例案件，未提交到 PayPal */
  sample?: boolean;
  updatedAt?: string;
  /** 争议商品名称 */
  itemName?: string;
  /** 结案结果，如 RESOLVED_SELLER_FAVOUR */
  outcome?: string;
};

export type WebhookItem = {
  id: string;
  receivedAt: string;
  headers?: Record<string, string>;
  event?: unknown;
};

export type ApiLogItem = {
  method: string;
  path: string;
  status: number;
  userId: string;
  payerId?: string;
  debugId?: string;
  ms: number;
  at?: string;
};
