import type { PayPalAccountStatus } from '@/api/types';

const LABELS: Record<PayPalAccountStatus, string> = {
  active: '正常',
  frozen: '冻结',
  pending: '待授权'
};

const TAG_TYPES: Record<PayPalAccountStatus, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success',
  frozen: 'error',
  pending: 'warning'
};

export function accountStatusLabel(status: PayPalAccountStatus | string): string {
  return LABELS[status as PayPalAccountStatus] || status || '未知';
}

export function accountStatusTagType(status: PayPalAccountStatus | string) {
  return TAG_TYPES[status as PayPalAccountStatus] || 'default';
}
