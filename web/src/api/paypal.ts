/**
 * PayPal 管理台前端 API 封装。
 *
 * 所有请求经 `paypalFetch`（见 ./http.ts）发出：
 * - 自动带 Bearer JWT（Pinia auth store）
 * - 路径拼到 VITE_PAYPAL_API_BASE / 开发代理 / 生产同源 /api
 * - 非 2xx 或误收到 HTML 时抛 ApiError
 *
 * 本文件只做「路径 + 入参序列化 + 解包常用字段」，不含业务状态。
 * 页面应调用这里的函数，不要直接拼 URL。
 */

import { paypalFetch } from './http';
import type {
  CartImageEnrichResult,
  DashboardStats,
  DisputeItem,
  PayPalAccount,
  ApiLogItem,
  TransactionItem,
  TransactionsPayload,
  WebhookItem,
  SyncTask,
  SyncLog
} from './types';

/* -------------------------------------------------------------------------- */
/* 仪表盘                                                                      */
/* -------------------------------------------------------------------------- */

/** 概览统计：账号数、已授权数、收款/提现合计、争议数等。 */
export async function fetchStats() {
  return paypalFetch<DashboardStats>('/stats');
}

/* -------------------------------------------------------------------------- */
/* 账号                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 账号列表。
 * @param params.mine 为 true 时只返回当前登录用户名下的账号（?mine=1）
 * @returns 解包后的 accounts 数组；后端缺字段时返回 []
 */
export async function fetchAccounts(params?: { mine?: boolean }) {
  const qs = params?.mine ? '?mine=1' : '';
  const data = await paypalFetch<{ accounts: PayPalAccount[] }>(`/accounts${qs}`);
  return data.accounts || [];
}

/**
 * 单个账号详情（含授权状态、scope、最近同步时间等）。
 * payerId 会 encode，避免特殊字符破坏路径。
 */
export async function fetchAccount(payerId: string) {
  const data = await paypalFetch<{ account: PayPalAccount }>(`/accounts/${encodeURIComponent(payerId)}`);
  return data.account;
}

/**
 * 局部更新账号元数据：备注、归属人、状态（active / frozen / pending）。
 * 不负责 OAuth；解除授权请用 revokeAccountAuth。
 */
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

/**
 * 解除该商家的 PayPal 授权（后端清除 refresh_token 等，账号通常变为 pending）。
 * HTTP 方法为 DELETE，语义是「撤销授权」，不是物理删库行。
 */
export async function revokeAccountAuth(payerId: string) {
  const data = await paypalFetch<{ account: PayPalAccount }>(`/accounts/${encodeURIComponent(payerId)}`, {
    method: 'DELETE'
  });
  return data.account;
}

/**
 * 从 PayPal 拉取并写入本地交易缓存。
 * @param days 回溯天数，默认 31（PayPal Reporting API 常见窗口上限附近）
 * @returns syncedAt、写入条数 count；失败时可带 PayPal debugId
 */
export async function syncAccountTransactions(payerId: string, days = 31) {
  return paypalFetch<{ syncedAt: string; count: number; debugId?: string }>(
    `/accounts/${encodeURIComponent(payerId)}/sync-transactions`,
    { method: 'POST', body: JSON.stringify({ days }) }
  );
}

/**
 * 读本地已同步的交易（可带 from/to，ISO 日期字符串）。
 * 未传时间范围时由后端决定默认窗口；有 from/to 时按发生时间过滤。
 */
export async function fetchAccountTransactions(
  payerId: string,
  range?: { from?: string; to?: string }
) {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const qs = params.toString();
  return paypalFetch<TransactionsPayload>(
    `/accounts/${encodeURIComponent(payerId)}/transactions${qs ? `?${qs}` : ''}`
  );
}

/**
 * 按 Order ID 向 PayPal 拉订单详情（需该账号令牌仍有效）。
 * 返回结构偏原始 JSON，页面侧自行展示。
 */
export async function fetchOrder(payerId: string, orderId: string) {
  return paypalFetch<{ order: unknown; debugId?: string }>(
    `/accounts/${encodeURIComponent(payerId)}/orders/${encodeURIComponent(orderId)}`
  );
}

/**
 * 用 custom_field（常为站内 orderId）/ invoiceId / 行项目信息，
 * 从站内购物车或本地缓存补全商品图 URL，供交易详情抽屉展示。
 */
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

/* -------------------------------------------------------------------------- */
/* 争议                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 本地已同步的争议列表。
 * 只读库表，不会现场打 PayPal；要刷新数据请先 syncDisputes。
 */
export async function fetchDisputes() {
  const data = await paypalFetch<{ disputes: DisputeItem[] }>('/disputes');
  return data.disputes || [];
}

/**
 * 争议详情：后端用该案件所属商家的令牌向 PayPal 拉实时数据并合并本地字段。
 */
export async function fetchDispute(id: string) {
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}`);
}

/**
 * 回应争议（JSON body）。
 *
 * action 与常用 body：
 * - send-message：message
 * - make-offer：amount、currency、note
 * - accept-claim：note
 * - escalate / appeal：按后端约定传字段
 *
 * 需要上传图片/PDF 时请用 provideEvidence（multipart），不要走本函数。
 */
export async function actOnDispute(
  id: string,
  action:
    | 'send-message'
    | 'provide-evidence'
    | 'make-offer'
    | 'accept-claim'
    | 'escalate'
    | 'appeal'
    | 'acknowledge-return-item'
    | 'provide-supporting-info',
  body: Record<string, unknown>
) {
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * 给买家发消息。有附件时走 multipart（PayPal 仅 JPG/PNG/GIF/PDF，约 10MB）。
 * 无附件时仍走 JSON send-message。
 */
export async function sendDisputeMessage(
  id: string,
  input: { message: string; files?: File[] }
) {
  if (!input.files?.length) {
    return actOnDispute(id, 'send-message', { message: input.message });
  }
  const form = new FormData();
  form.append('message', input.message);
  for (const file of input.files) form.append('files', file, file.name);
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}/send-message`, {
    method: 'POST',
    body: form
  });
}

/** 补充说明（provide-supporting-info），可附同样类型的文件。 */
export async function sendSupportingInfo(
  id: string,
  input: { notes: string; files?: File[] }
) {
  if (!input.files?.length) {
    return actOnDispute(id, 'provide-supporting-info', { notes: input.notes });
  }
  const form = new FormData();
  form.append('notes', input.notes);
  for (const file of input.files) form.append('files', file, file.name);
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}/provide-supporting-info`, {
    method: 'POST',
    body: form
  });
}

/**
 * 提交争议证据（multipart/form-data）。
 * notes、trackingNumber、files 至少填一项；文件字段名固定为 files（可多文件）。
 * Content-Type 由浏览器根据 FormData 自动带 boundary，paypalFetch 不会强行设 JSON。
 */
export async function provideEvidence(
  id: string,
  input: {
    notes?: string;
    trackingNumber?: string;
    carrierName?: string;
    evidenceType?: string;
    files?: File[];
  }
) {
  const form = new FormData();
  if (input.notes) form.append('notes', input.notes);
  if (input.trackingNumber) form.append('trackingNumber', input.trackingNumber);
  if (input.carrierName) form.append('carrierName', input.carrierName);
  if (input.evidenceType) form.append('evidenceType', input.evidenceType);
  for (const file of input.files || []) form.append('files', file, file.name);
  return paypalFetch<DisputeItem>(`/disputes/${encodeURIComponent(id)}/provide-evidence`, {
    method: 'POST',
    body: form
  });
}

/**
 * 按已授权账号批量从 PayPal 拉争议摘要并写入本地。
 * 商家令牌缺少争议相关 scope 时会失败，需重新走 OAuth 授权。
 */
export async function syncDisputes() {
  return paypalFetch<{ ok: boolean; message?: string }>('/disputes/sync', { method: 'POST' });
}

/**
 * 用已缓存的真实交易生成示例争议，只写本地库，不调 PayPal。
 * 用于联调列表/详情 UI；生产环境应慎用或关闭对应接口。
 */
export async function seedSampleDisputes() {
  return paypalFetch<{ ok: boolean; count: number; message?: string; ids?: string[] }>('/disputes/samples', {
    method: 'POST'
  });
}

/* -------------------------------------------------------------------------- */
/* 同步任务                                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchSyncTasks() {
  const data = await paypalFetch<{ tasks: SyncTask[] }>('/sync/tasks');
  return data.tasks || [];
}

export async function createSyncTask(body: Partial<SyncTask> & { type: string }) {
  return paypalFetch<SyncTask>('/sync/tasks', { method: 'POST', body: JSON.stringify(body) });
}

export async function patchSyncTask(id: string, body: Partial<SyncTask>) {
  return paypalFetch<SyncTask>(`/sync/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

export async function deleteSyncTask(id: string) {
  return paypalFetch<{ ok: boolean }>(`/sync/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function runSyncTask(id: string) {
  return paypalFetch<{ ok?: boolean; message?: string; count?: number }>(
    `/sync/tasks/${encodeURIComponent(id)}/run`,
    { method: 'POST' }
  );
}

export async function fetchSyncLogs(params?: { taskId?: string; type?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.taskId) qs.set('taskId', params.taskId);
  if (params?.type) qs.set('type', params.type);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  const data = await paypalFetch<{ logs: SyncLog[] }>(`/sync/logs${suffix}`);
  return data.logs || [];
}

/* -------------------------------------------------------------------------- */
/* 运维日志                                                                    */
/* -------------------------------------------------------------------------- */

/** 最近收到的 PayPal Webhook 事件（本地落库），默认最多 50 条。 */
export async function fetchWebhooks(limit = 50) {
  const data = await paypalFetch<{ webhooks: WebhookItem[] }>(`/webhooks?limit=${limit}`);
  return data.webhooks || [];
}

/** 本服务对外 API 访问日志，默认最多 100 条。 */
export async function fetchApiLogs(limit = 100) {
  const data = await paypalFetch<{ logs: ApiLogItem[] }>(`/logs?limit=${limit}`);
  return data.logs || [];
}

/* -------------------------------------------------------------------------- */
/* 跨账号聚合（前端拼装）                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 跨账号聚合交易列表（并发请求各账号，再在浏览器侧合并排序）。
 *
 * 行为要点：
 * - 最多取前 20 个账号，避免一次打爆后端
 * - 有 from/to 时按服务端过滤结果全量并入，不再 perAccount 截断
 * - 无时间范围时每个账号最多 perAccount 条，合并后再截到 maxTotal
 * - 单账号请求失败被吞掉，不影响其余账号
 * - 按 transaction_initiation_date 降序排序
 */
export async function fetchRecentTransactionsAcrossAccounts(
  accounts: PayPalAccount[],
  perAccount = 100,
  maxTotal = 500,
  range?: { from?: string; to?: string }
): Promise<
  Array<{
    payerId: string;
    email: string;
    tx: TransactionItem;
  }>
> {
  const slice = accounts.slice(0, 20);
  const rows: Array<{ payerId: string; email: string; tx: TransactionItem }> = [];
  const ranged = Boolean(range?.from || range?.to);
  await Promise.all(
    slice.map(async acc => {
      try {
        const { items } = await fetchAccountTransactions(acc.payerId, range);
        const list = ranged ? items || [] : (items || []).slice(0, perAccount);
        for (const tx of list) {
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
  return ranged ? rows : rows.slice(0, maxTotal);
}
