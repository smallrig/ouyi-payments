/** PayPal 争议原因码对应的页面文案。 */
const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: '未收到商品',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: '商品与描述不符',
  UNAUTHORISED: '未授权交易',
  CREDIT_NOT_PROCESSED: '退款未到账',
  DUPLICATE_TRANSACTION: '重复扣款',
  CANCELED_RECURRING_BILLING: '已取消的续费',
  PROBLEM_WITH_REMITTANCE: '汇款问题',
  OTHER: '其他'
};

/** 争议所处阶段。不同阶段能做的操作不一样。 */
const STAGES: Record<string, string> = {
  INQUIRY: '调查',
  CHARGEBACK: '索赔',
  PRE_ARBITRATION: '仲裁前',
  ARBITRATION: '仲裁'
};

const EVIDENCE: Record<string, string> = {
  PROOF_OF_FULFILLMENT: '发货证明',
  PROOF_OF_REFUND: '退款凭证',
  OTHER: '其他说明'
};

const STATUSES: Record<string, string> = {
  OPEN: '申诉中',
  UNDER_REVIEW: '审核中',
  RESOLVED: '已解决',
  WAITING_FOR_BUYER_RESPONSE: '等待买家',
  WAITING_FOR_SELLER_RESPONSE: '需补充'
};

const OUTCOMES: Record<string, string> = {
  RESOLVED_BUYER_FAVOUR: '买家胜诉',
  RESOLVED_SELLER_FAVOUR: '卖家胜诉',
  RESOLVED_WITH_PAYOUT: '已赔付',
  CANCELED_BY_BUYER: '买家撤销'
};

export const disputeStatusOptions = Object.entries(STATUSES).map(([value, label]) => ({ value, label }));
export const disputeStageOptions = Object.entries(STAGES).map(([value, label]) => ({ value, label }));
export const disputeReasonOptions = Object.entries(REASONS).map(([value, label]) => ({ value, label }));

export function statusLabel(status?: string) {
  if (!status) return '—';
  return STATUSES[status] || status;
}

export function outcomeLabel(code?: string) {
  if (!code) return '';
  return OUTCOMES[code] || code;
}

export function reasonLabel(reason?: string) {
  if (!reason) return '—';
  return REASONS[reason] || reason;
}

export function stageLabel(stage?: string) {
  if (!stage) return '—';
  return STAGES[stage] || stage;
}

export function evidenceLabel(type?: string) {
  if (!type) return '证据';
  return EVIDENCE[type] || type;
}
