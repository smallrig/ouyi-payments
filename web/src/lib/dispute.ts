import type { DisputeItem } from '@/api/types';

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

/**
 * 生命周期阶段。
 * PayPal Customer Disputes：INQUIRY 为买家询单/投诉；其后 CHARGEBACK 等为正式争议。
 * 产品上拆成「客户投诉」「争议案件」两个菜单，见 isComplaint / isDisputeCase。
 */
const STAGES: Record<string, string> = {
  INQUIRY: '客户投诉',
  CHARGEBACK: '拒付索赔',
  PRE_ARBITRATION: '仲裁前',
  ARBITRATION: '仲裁'
};

/** 列表页 Tab：complaints = 投诉，disputes = 正式争议 */
export type CaseListTab = 'complaints' | 'disputes';

const EVIDENCE: Record<string, string> = {
  PROOF_OF_FULFILLMENT: '发货 / 妥投证明',
  PROOF_OF_REFUND: '退款凭证',
  PROOF_OF_DELIVERY_SIGNATURE: '签收证明',
  PROOF_OF_RECEIPT_COPY: '收据副本',
  RETURN_POLICY: '退货政策',
  PRODUCT_DESCRIPTION: '商品描述',
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

/** 取案件生命周期阶段（兼容旧字段 caseType）。缺省按投诉询单处理。 */
export function disputeStageOf(row: Pick<DisputeItem, 'lifeCycleStage' | 'caseType'>): string {
  return String(row.lifeCycleStage || row.caseType || 'INQUIRY').trim() || 'INQUIRY';
}

/**
 * 客户投诉：仍处于 INQUIRY（买家向卖家询单，尚未升级为拒付/仲裁）。
 * 与 PayPal Dashboard「Inquiry」对应。
 */
export function isComplaint(row: Pick<DisputeItem, 'lifeCycleStage' | 'caseType'>): boolean {
  return disputeStageOf(row) === 'INQUIRY';
}

/** 正式争议：CHARGEBACK / PRE_ARBITRATION / ARBITRATION 等非询单阶段。 */
export function isDisputeCase(row: Pick<DisputeItem, 'lifeCycleStage' | 'caseType'>): boolean {
  return !isComplaint(row);
}

export function caseKindLabel(row: Pick<DisputeItem, 'lifeCycleStage' | 'caseType'>): string {
  return isComplaint(row) ? '客户投诉' : '争议案件';
}

/** 未结案（首页「待处理」统计用）。 */
export function isOpenCase(row: Pick<DisputeItem, 'status'>): boolean {
  return row.status !== 'RESOLVED';
}

export function filterByCaseTab(rows: DisputeItem[], tab: CaseListTab): DisputeItem[] {
  return rows.filter(row => (tab === 'complaints' ? isComplaint(row) : isDisputeCase(row)));
}

export type DisputeAction =
  | 'send-message'
  | 'provide-evidence'
  | 'make-offer'
  | 'accept-claim'
  | 'escalate'
  | 'appeal'
  | 'acknowledge-return-item'
  | 'provide-supporting-info';

/** 是否允许某操作：有 allowedActions 时严格匹配；无则默认允许常用操作。 */
export function canDoAction(row: DisputeItem | null | undefined, action: DisputeAction): boolean {
  if (!row) return false;
  const list = row.allowedActions;
  if (!list?.length) {
    return ['send-message', 'provide-evidence', 'make-offer', 'accept-claim'].includes(action);
  }
  return list.includes(action);
}

/** 卖家需响应（应优先举证 / 回复）。 */
export function needsSellerResponse(row: Pick<DisputeItem, 'status'> | null | undefined): boolean {
  return row?.status === 'WAITING_FOR_SELLER_RESPONSE';
}

/**
 * 按争议原因推荐证据类型（PayPal evidence_type）。
 * INR → 物流妥投 / 退款；SNAD → 商品描述 / 退货政策等。
 */
export function recommendedEvidenceTypes(reason?: string): Array<{ value: string; label: string; hint: string }> {
  const inr = reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
  const snad = reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED';
  if (inr) {
    return [
      {
        value: 'PROOF_OF_FULFILLMENT',
        label: EVIDENCE.PROOF_OF_FULFILLMENT,
        hint: '未收到货：提供承运商与物流单号（妥投证明）'
      },
      {
        value: 'PROOF_OF_REFUND',
        label: EVIDENCE.PROOF_OF_REFUND,
        hint: '若已退款，上传退款凭证'
      },
      { value: 'OTHER', label: EVIDENCE.OTHER, hint: '其它补充说明' }
    ];
  }
  if (snad) {
    return [
      {
        value: 'PRODUCT_DESCRIPTION',
        label: EVIDENCE.PRODUCT_DESCRIPTION,
        hint: '货不对板：商品页面描述、规格截图'
      },
      {
        value: 'RETURN_POLICY',
        label: EVIDENCE.RETURN_POLICY,
        hint: '退货 / 退款政策说明'
      },
      {
        value: 'PROOF_OF_REFUND',
        label: EVIDENCE.PROOF_OF_REFUND,
        hint: '已处理退款时附上凭证'
      },
      { value: 'OTHER', label: EVIDENCE.OTHER, hint: '其它补充说明' }
    ];
  }
  return [
    { value: 'PROOF_OF_FULFILLMENT', label: EVIDENCE.PROOF_OF_FULFILLMENT, hint: '发货与物流证明' },
    { value: 'PROOF_OF_REFUND', label: EVIDENCE.PROOF_OF_REFUND, hint: '退款凭证' },
    { value: 'OTHER', label: EVIDENCE.OTHER, hint: '其它补充说明' }
  ];
}

export function defaultEvidenceType(reason?: string): string {
  return recommendedEvidenceTypes(reason)[0]?.value || 'OTHER';
}
