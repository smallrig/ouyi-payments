export function formatMoney(value: number | null | undefined, currency = 'USD') {
  if (value == null || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export function formatTxAmount(item: { transaction_info?: { transaction_amount?: { value?: string; currency_code?: string } } }) {
  const amt = item.transaction_info?.transaction_amount;
  if (!amt?.value) return '—';
  const num = Number(amt.value);
  const cur = amt.currency_code || 'USD';
  if (Number.isNaN(num)) return `${amt.value} ${cur}`;
  return formatMoney(num, cur);
}

export function formatDateTime(iso: string | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}
