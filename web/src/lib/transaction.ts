import type { TransactionItem } from '@/api/types';
import { formatDateTime, formatMoney } from './format';

export type TxRow = {
  payerId: string;
  email: string;
  tx: TransactionItem;
};

const STATUS_MAP: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  S: { label: '成功', type: 'success' },
  P: { label: '处理中', type: 'warning' },
  D: { label: '拒绝', type: 'error' },
  V: { label: '撤销', type: 'error' },
  F: { label: '部分退款', type: 'info' },
  C: { label: '取消', type: 'default' }
};

const EVENT_MAP: Record<string, string> = {
  T0000: '通用支付',
  T0001: '批量付款',
  T0002: '订阅付款',
  T0003: '预批准支付',
  T0005: '收费 / Recurring',
  T0006: '结账收款',
  T0007: '付款复查',
  T0011: '移动支付',
  T0013: '捐赠',
  T0100: '退款',
  T0101: '退款取消',
  T0200: '货币兑换 / 相关',
  T0300: '银行提现',
  T0400: '用户发起提现',
  T1106: '付款撤消',
  T1107: '付款退回',
  T1114: '拒付 / 争议',
  T1201: '收费退款'
};

export function txInfo(tx: TransactionItem) {
  return tx.transaction_info || {};
}

export function txStatusMeta(code?: string) {
  if (!code) return { label: '—', type: 'default' as const };
  return STATUS_MAP[code] || { label: code, type: 'default' as const };
}

export function txEventLabel(code?: string) {
  if (!code) return '—';
  return EVENT_MAP[code] || code;
}

/** 已知类型下拉；也可传入当前数据里出现过的 code 做补充 */
export function txEventOptions(extraCodes: string[] = []) {
  const codes = new Set([...Object.keys(EVENT_MAP), ...extraCodes.filter(Boolean)]);
  return [...codes]
    .sort()
    .map(code => ({
      label: EVENT_MAP[code] ? `${EVENT_MAP[code]}（${code}）` : code,
      value: code
    }));
}

export function formatAmountObj(amt?: { currency_code?: string; value?: string } | null) {
  if (!amt?.value) return '—';
  const num = Number(amt.value);
  const cur = amt.currency_code || 'USD';
  if (Number.isNaN(num)) return `${amt.value} ${cur}`;
  return formatMoney(num, cur);
}

export function txAmountNumber(tx: TransactionItem) {
  const v = Number(txInfo(tx).transaction_amount?.value);
  return Number.isFinite(v) ? v : 0;
}

export function txCounterparty(tx: TransactionItem) {
  const payer = tx.payer_info;
  if (!payer) return '—';
  const name = [payer.payer_name?.given_name, payer.payer_name?.surname].filter(Boolean).join(' ');
  return payer.email_address || name || payer.account_id || '—';
}

export function txCounterpartyName(tx: TransactionItem) {
  const payer = tx.payer_info;
  if (!payer?.payer_name) return '';
  return [payer.payer_name.given_name, payer.payer_name.surname].filter(Boolean).join(' ');
}

export function txSubject(tx: TransactionItem) {
  const info = txInfo(tx);
  const cartName = tx.cart_info?.item_details?.[0]?.item_name;
  return info.transaction_subject || cartName || info.invoice_id || '—';
}

export function txId(tx: TransactionItem) {
  return txInfo(tx).transaction_id || '';
}

export function txInitiatedAt(tx: TransactionItem) {
  return formatDateTime(txInfo(tx).transaction_initiation_date);
}

export function summarizeRows(rows: TxRow[]) {
  let inflow = 0;
  let outflow = 0;
  const currencies = new Set<string>();
  for (const row of rows) {
    const info = txInfo(row.tx);
    const cur = info.transaction_amount?.currency_code;
    if (cur) currencies.add(cur);
    const n = txAmountNumber(row.tx);
    if (n >= 0) inflow += n;
    else outflow += Math.abs(n);
  }
  return {
    count: rows.length,
    inflow,
    outflow,
    multiCurrency: currencies.size > 1,
    currency: currencies.size === 1 ? [...currencies][0] : 'USD'
  };
}
