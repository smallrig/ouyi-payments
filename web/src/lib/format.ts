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

/** Hero / 指标用的短时间：今天只显示时分，否则月-日 时:分 */
export function formatShortDateTime(iso: string | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `今天 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}
