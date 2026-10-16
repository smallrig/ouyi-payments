import { paypalFetch } from './http';
import type {
  CartImageEnrichResult,
  DashboardStats,
  DisputeItem,
  PayPalAccount,
  ApiLogItem,
  TransactionItem,
  TransactionsPayload,
  WebhookItem
} from './types';

export async function fetchStats() {
  return paypalFetch<DashboardStats>('/stats');
}

export async function fetchAccounts(params?: { mine?: boolean }) {
  const qs = params?.mine ? '?mine=1' : '';
  const data = await paypalFetch<{ accounts: PayPalAccount[] }>(`/accounts${qs}`);
  return data.accounts || [];
}

export async function fetchAccount(payerId: string) {
  const data = await paypalFetch<{ account: PayPalAccount }>(`/accounts/${encodeURIComponent(payerId)}`);
  return data.account;
}

export async function patchAccount(
  payerId: string,
  patch: Partial<Pick<PayPalAccount, 'note' | 'ownerUserId' | 'ownerName' | 'status'>>
) {
  const data = await paypalFetch<{ account: PayPalAccount }>(`/accounts/${encodeURIComponent(payerId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  return data.account;
}

export async function revokeAccountAuth(payerId: string) {
  const data = await paypalFetch<{ account: PayPalAccount }>(`/accounts/${encodeURIComponent(payerId)}`, {
    method: 'DELETE'
  });
  return data.account;
}

export async function syncAccountTransactions(payerId: string, days = 31) {
  return paypalFetch<{ syncedAt: string; count: number; debugId?: string }>(
    `/accounts/${encodeURIComponent(payerId)}/sync-transactions`,
    { method: 'POST', body: JSON.stringify({ days }) }
  );
}

export async function fetchAccountTransactions(payerId: string) {
  return paypalFetch<TransactionsPayload>(`/accounts/${encodeURIComponent(payerId)}/transactions`);
}

export async function fetchOrder(payerId: string, orderId: string) {
  return paypalFetch<{ order: unknown; debugId?: string }>(
    `/accounts/${encodeURIComponent(payerId)}/orders/${encodeURIComponent(orderId)}`
  );
}

/** 用 custom_field(orderId) / 本地缓存补全购物车商品图 */
export async function enrichCartImages(
  payerId: string,
  body: {
    customField?: string;
    invoiceId?: string;
    items: Array<{
      item_code?: string;
      item_name?: string;
      item_description?: string;
      invoice_number?: string;
    }>;
  }
) {
  return paypalFetch<CartImageEnrichResult>(
    `/accounts/${encodeURIComponent(payerId)}/cart-images`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

/** 本地已同步的争议列表，不会现场打 PayPal。 */
export async function fetchDisputes() {
  const data = await paypalFetch<{ disputes: DisputeItem[] }>('/disputes');
  return data.disputes || [];
}

/** 打开详情：后端用该案件所属商家的令牌向 PayPal 拉实时数据。 */
export async function fetchDispute(id: string) {
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}`);
}

/**
 * 回应争议。
 * send-message 传 message；make-offer 传 amount、currency、note；accept-claim 传 note。
 * 提交证据走 provideEvidence，以便附带图片或 PDF。
 */
export async function actOnDispute(
  id: string,
  action: 'send-message' | 'provide-evidence' | 'make-offer' | 'accept-claim' | 'escalate' | 'appeal',
  body: Record<string, unknown>
) {
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/** 提交证据。说明、物流单号、图片或 PDF 至少填一项。文件走 multipart，字段名 files。 */
export async function provideEvidence(
  id: string,
  input: { notes?: string; trackingNumber?: string; files?: File[] }
) {
  const form = new FormData();
  if (input.notes) form.append('notes', input.notes);
  if (input.trackingNumber) form.append('trackingNumber', input.trackingNumber);
  for (const file of input.files || []) form.append('files', file, file.name);
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}/provide-evidence`, {
    method: 'POST',
    body: form
  });
}

/** 按已授权账号拉取 PayPal 争议摘要。令牌没有争议权限时会失败，需要重新授权。 */
export async function syncDisputes() {
  return paypalFetch<{ ok: boolean; message?: string }>('/disputes/sync', { method: 'POST' });
}

/** 用已缓存的真实交易生成示例争议，只写本地库，用来把列表和详情页填满。 */
export async function seedSampleDisputes() {
  return paypalFetch<{ ok: boolean; count: number; message?: string; ids?: string[] }>('/disputes/samples', {
    method: 'POST'
  });
}

export async function fetchWebhooks(limit = 50) {
  const data = await paypalFetch<{ webhooks: WebhookItem[] }>(`/webhooks?limit=${limit}`);
  return data.webhooks || [];
}

export async function fetchApiLogs(limit = 100) {
  const data = await paypalFetch<{ logs: ApiLogItem[] }>(`/logs?limit=${limit}`);
  return data.logs || [];
}

/** 跨账号聚合最近交易（前端组合，供分页浏览） */
export async function fetchRecentTransactionsAcrossAccounts(
  accounts: PayPalAccount[],
  perAccount = 100,
  maxTotal = 500
): Promise<
  Array<{
    payerId: string;
    email: string;
    tx: TransactionItem;
  }>
> {
  const slice = accounts.slice(0, 20);
  const rows: Array<{ payerId: string; email: string; tx: TransactionItem }> = [];
  await Promise.all(
    slice.map(async acc => {
      try {
        const { items } = await fetchAccountTransactions(acc.payerId);
        for (const tx of (items || []).slice(0, perAccount)) {
          rows.push({ payerId: acc.payerId, email: acc.email, tx });
        }
      } catch {
        /* 单账号失败不影响列表 */
      }
    })
  );
  rows.sort((a, b) => {
    const da = a.tx.transaction_info?.transaction_initiation_date || '';
    const db = b.tx.transaction_info?.transaction_initiation_date || '';
    return db.localeCompare(da);
  });
  return rows.slice(0, maxTotal);
}
