<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NModal, useMessage } from 'naive-ui';
import PpAsyncPane from '@/components/PpAsyncPane.vue';
import PpEmptyState from '@/components/PpEmptyState.vue';
import { actOnDispute, fetchDispute, provideEvidence, sendDisputeMessage, sendSupportingInfo } from '@/api/paypal';
import type { DisputeItem } from '@/api/types';
import {
  canDoAction,
  caseKindLabel,
  defaultEvidenceType,
  evidenceLabel,
  isComplaint,
  needsSellerResponse,
  reasonLabel,
  recommendedEvidenceTypes,
  stageLabel,
  type DisputeAction
} from '@/lib/dispute';
import { formatDateTime } from '@/lib/format';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const loading = ref(true);
const acting = ref(false);
const dispute = ref<DisputeItem | null>(null);
const tab = ref<'progress' | 'tx' | 'records' | 'files'>('progress');
const dialog = ref<
  'message' | 'evidence' | 'outcome' | 'escalate' | 'appeal' | 'acknowledge' | 'supporting' | null
>(null);
const messageText = ref('');
const evidenceNote = ref('');
const trackingNumber = ref('');
const carrierName = ref('');
const evidenceType = ref('PROOF_OF_FULFILLMENT');
const offerAmount = ref('');
const offerNote = ref('卖家提议退款');
const escalateNote = ref('');
const appealNote = ref('');
const acknowledgeNote = ref('');
const acknowledgeType = ref<'ITEM_RECEIVED' | 'ITEM_NOT_RECEIVED' | 'DAMAGED'>('ITEM_RECEIVED');
const supportingNote = ref('');
const evidenceFiles = ref<File[]>([]);
const messageFiles = ref<File[]>([]);
const supportingFiles = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);
const messageFileInput = ref<HTMLInputElement | null>(null);
const supportingFileInput = ref<HTMLInputElement | null>(null);

const EVIDENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'application/pdf']);
const MAX_EVIDENCE_BYTES = Number(import.meta.env.VITE_EVIDENCE_MAX_FILE_BYTES || 10 * 1024 * 1024);
const MAX_EVIDENCE_FILES = Number(import.meta.env.VITE_EVIDENCE_MAX_FILES || 5);
const maxEvidenceMb = Math.round(MAX_EVIDENCE_BYTES / (1024 * 1024));

const id = computed(() => String(route.params.id || ''));

function statusLabel(status: string) {
  const map: Record<string, string> = {
    OPEN: '申诉中',
    UNDER_REVIEW: '审核中',
    RESOLVED: '已解决',
    WAITING_FOR_BUYER_RESPONSE: '等待买家',
    WAITING_FOR_SELLER_RESPONSE: '需补充'
  };
  return map[status] || status;
}

function badgeTone(status: string) {
  if (status === 'OPEN' || status === 'UNDER_REVIEW') return 'bad';
  if (status === 'RESOLVED') return 'ok';
  if (status === 'WAITING_FOR_BUYER_RESPONSE' || status === 'WAITING_FOR_SELLER_RESPONSE') return 'warn';
  return 'mute';
}

const amountText = computed(() => {
  if (!dispute.value?.amount) return '—';
  return `${dispute.value.amount.value} ${dispute.value.amount.currency_code || ''}`.trim();
});

const kindTitle = computed(() => (dispute.value ? caseKindLabel(dispute.value) : '案件'));

const listRoute = computed(() => {
  const from = route.query.from;
  if (from === 'complaints') return { name: 'complaints' as const };
  if (from === 'disputes') return { name: 'disputes' as const };
  if (dispute.value && isComplaint(dispute.value)) return { name: 'complaints' as const };
  return { name: 'disputes' as const };
});

const sellerMustAct = computed(() => needsSellerResponse(dispute.value));

type CaseActionItem = {
  key: DisputeAction;
  label: string;
  icon: string;
  primary?: boolean;
  run: () => void;
};

const caseActions = computed<CaseActionItem[]>(() => {
  if (!dispute.value) return [];
  const complaint = isComplaint(dispute.value);
  const items: CaseActionItem[] = [];
  if (allow('send-message')) {
    items.push({
      key: 'send-message',
      label: complaint ? '回应投诉' : '联系买家',
      icon: 'mdi:message-reply-text-outline',
      primary: true,
      run: () => {
        dialog.value = 'message';
      }
    });
  }
  if (allow('provide-evidence')) {
    items.push({
      key: 'provide-evidence',
      label: '提交证据',
      icon: 'mdi:file-upload-outline',
      primary: !items.length && sellerMustAct.value,
      run: openEvidenceDialog
    });
  }
  if (allow('make-offer') || allow('accept-claim')) {
    items.push({
      key: 'make-offer',
      label: '和解方案',
      icon: 'mdi:handshake-outline',
      run: openOutcomeDialog
    });
  }
  if (allow('escalate')) {
    items.push({
      key: 'escalate',
      label: '升级争议',
      icon: 'mdi:arrow-up-bold-circle-outline',
      run: () => {
        dialog.value = 'escalate';
      }
    });
  }
  if (allow('appeal')) {
    items.push({
      key: 'appeal',
      label: '申诉裁决',
      icon: 'mdi:gavel',
      run: () => {
        dialog.value = 'appeal';
      }
    });
  }
  if (allow('acknowledge-return-item')) {
    items.push({
      key: 'acknowledge-return-item',
      label: '确认退货',
      icon: 'mdi:package-variant-closed-check',
      run: () => {
        dialog.value = 'acknowledge';
      }
    });
  }
  if (allow('provide-supporting-info')) {
    items.push({
      key: 'provide-supporting-info',
      label: '补充说明',
      icon: 'mdi:text-box-plus-outline',
      run: () => {
        dialog.value = 'supporting';
      }
    });
  }
  return items;
});

const evidenceTypeOptions = computed(() => recommendedEvidenceTypes(dispute.value?.reason));

const evidenceTypeHint = computed(
  () => evidenceTypeOptions.value.find(o => o.value === evidenceType.value)?.hint || ''
);

function allow(action: DisputeAction) {
  return canDoAction(dispute.value, action);
}

const caseType = computed(() => {
  const stage = dispute.value?.lifeCycleStage || dispute.value?.caseType;
  if (stage) return stageLabel(stage);
  return reasonLabel(dispute.value?.reason);
});

const relatedTx = computed(() => dispute.value?.relatedTransactionId || '—');

const buyerEmail = computed(() => dispute.value?.buyerEmail || '—');

const deadlineAt = computed(() => {
  if (dispute.value?.deadlineAt) return formatDateTime(dispute.value.deadlineAt);
  if (!dispute.value?.createdAt) return '—';
  const d = new Date(dispute.value.createdAt);
  if (Number.isNaN(d.getTime())) return '—';
  d.setDate(d.getDate() + 13);
  return formatDateTime(d.toISOString());
});

const timeline = computed(() => {
  if (dispute.value?.timeline?.length) return dispute.value.timeline;
  if (!dispute.value) return [];
  const created = dispute.value.createdAt;
  const resolved = dispute.value.status === 'RESOLVED';
  const underReview = dispute.value.status === 'UNDER_REVIEW' || resolved;
  const opened = isComplaint(dispute.value) ? '买家提交投诉' : '买家提出争议';
  return [
    { at: created, title: opened, done: true },
    {
      at: created,
      title: 'PayPal 介入',
      done: underReview || dispute.value.status === 'OPEN'
    },
    {
      at: created,
      title: '处理中',
      done: underReview
    },
    {
      at: dispute.value.deadlineAt || '',
      title: resolved ? '已结案' : '预计处理完成',
      done: resolved
    }
  ];
});

const records = computed(() => dispute.value?.notes || []);
const evidences = computed(() => dispute.value?.evidences || []);

async function load() {
  loading.value = true;
  try {
    dispute.value = await fetchDispute(id.value);
  } catch (err) {
    dispute.value = null;
    message.error(err instanceof Error ? err.message : '加载案件失败');
  } finally {
    loading.value = false;
  }
}

async function runAction(action: DisputeAction, body: Record<string, unknown>) {
  if (!dispute.value || acting.value) return;
  if (!allow(action)) {
    message.warning('当前阶段不允许此操作（PayPal links 未授权）');
    return;
  }
  acting.value = true;
  try {
    dispute.value = await actOnDispute(dispute.value.id, action, body);
    message.success(dispute.value.sample ? '已更新示例案件' : '已提交到 PayPal');
    dialog.value = null;
    messageText.value = '';
    evidenceNote.value = '';
    trackingNumber.value = '';
    carrierName.value = '';
    offerNote.value = '卖家提议退款';
    escalateNote.value = '';
    appealNote.value = '';
    acknowledgeNote.value = '';
    supportingNote.value = '';
    evidenceFiles.value = [];
    messageFiles.value = [];
    supportingFiles.value = [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败');
  } finally {
    acting.value = false;
  }
}

function openEvidenceDialog() {
  evidenceType.value = defaultEvidenceType(dispute.value?.reason);
  dialog.value = 'evidence';
}

function openOutcomeDialog() {
  offerAmount.value = dispute.value?.amount?.value || '';
  offerNote.value = '卖家提议退款';
  dialog.value = 'outcome';
}

function collectFiles(current: File[], incoming: File[]) {
  const next = [...current];
  for (const file of incoming) {
    const type = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
    if (!EVIDENCE_TYPES.has(type)) {
      message.warning(`${file.name} 不是 JPG、PNG、GIF 或 PDF`);
      continue;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      message.warning(`${file.name} 超过 ${maxEvidenceMb}MB`);
      continue;
    }
    if (next.length >= MAX_EVIDENCE_FILES) {
      message.warning(`最多上传 ${MAX_EVIDENCE_FILES} 个文件`);
      break;
    }
    next.push(file);
  }
  return next;
}

function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  evidenceFiles.value = collectFiles(evidenceFiles.value, Array.from(input.files || []));
  input.value = '';
}

function onPickMessageFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  messageFiles.value = collectFiles(messageFiles.value, Array.from(input.files || []));
  input.value = '';
}

function onPickSupportingFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  supportingFiles.value = collectFiles(supportingFiles.value, Array.from(input.files || []));
  input.value = '';
}

function removeEvidenceFile(index: number) {
  evidenceFiles.value = evidenceFiles.value.filter((_, i) => i !== index);
}

async function submitMessage() {
  if (!dispute.value || acting.value) return;
  if (!allow('send-message')) {
    message.warning('当前阶段不允许发消息');
    return;
  }
  if (!messageText.value.trim()) return;
  acting.value = true;
  try {
    dispute.value = await sendDisputeMessage(dispute.value.id, {
      message: messageText.value.trim(),
      files: messageFiles.value
    });
    message.success(dispute.value.sample ? '已更新示例案件' : '已提交到 PayPal');
    dialog.value = null;
    messageText.value = '';
    messageFiles.value = [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败');
  } finally {
    acting.value = false;
  }
}

async function submitSupporting() {
  if (!dispute.value || acting.value) return;
  if (!allow('provide-supporting-info')) {
    message.warning('当前阶段不允许补充说明');
    return;
  }
  if (!supportingNote.value.trim() && !supportingFiles.value.length) return;
  acting.value = true;
  try {
    dispute.value = await sendSupportingInfo(dispute.value.id, {
      notes: supportingNote.value.trim(),
      files: supportingFiles.value
    });
    message.success(dispute.value.sample ? '已更新示例案件' : '已提交到 PayPal');
    dialog.value = null;
    supportingNote.value = '';
    supportingFiles.value = [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败');
  } finally {
    acting.value = false;
  }
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function submitEvidence() {
  if (!dispute.value || acting.value) return;
  if (!allow('provide-evidence')) {
    message.warning('当前阶段不允许提交证据');
    return;
  }
  if (!evidenceNote.value.trim() && !trackingNumber.value.trim() && !evidenceFiles.value.length) return;
  acting.value = true;
  try {
    dispute.value = await provideEvidence(dispute.value.id, {
      notes: evidenceNote.value.trim(),
      trackingNumber: trackingNumber.value.trim(),
      carrierName: carrierName.value.trim() || undefined,
      evidenceType: evidenceType.value,
      files: evidenceFiles.value
    });
    message.success(dispute.value.sample ? '已更新示例案件' : '已提交到 PayPal');
    dialog.value = null;
    evidenceNote.value = '';
    trackingNumber.value = '';
    carrierName.value = '';
    evidenceFiles.value = [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败');
  } finally {
    acting.value = false;
  }
}

onMounted(() => void load());
watch(id, () => {
  tab.value = 'progress';
  void load();
});
</script>

<template>
  <div class="pp-page detail">
    <button type="button" class="back" @click="router.push(listRoute)">
      <Icon icon="mdi:arrow-left" width="16" />
      返回{{ kindTitle === '客户投诉' ? '投诉' : '争议' }}列表
    </button>

    <PpAsyncPane
      :loading="loading"
      icon="mdi:shield-search-outline"
      :title="`加载${kindTitle}详情`"
      description="正在获取案件信息…"
      min-height="360px"
    >
      <template v-if="dispute">
        <section class="summary">
          <div class="summary__head">
            <h1 class="summary__id">{{ dispute.id }}</h1>
            <span class="pp-badge pp-badge--info">{{ kindTitle }}</span>
            <span class="pp-badge" :class="`pp-badge--${badgeTone(dispute.status)}`">
              {{ statusLabel(dispute.status) }}
            </span>
            <span v-if="dispute.sample" class="pp-badge pp-badge--mute">示例</span>
          </div>

          <div class="summary__grid">
            <div class="field">
              <span class="field__label">关联交易</span>
              <button
                v-if="relatedTx !== '—'"
                type="button"
                class="field__link"
                @click="router.push({ name: 'transactions' })"
              >
                {{ relatedTx }}
              </button>
              <span v-else class="field__value">—</span>
            </div>
            <div class="field">
              <span class="field__label">案件状态</span>
              <span class="field__value" :class="{ 'is-alert': badgeTone(dispute.status) === 'bad' }">
                {{ statusLabel(dispute.status) }}
              </span>
            </div>
            <div class="field">
              <span class="field__label">金额</span>
              <span class="field__value field__value--strong">{{ amountText }}</span>
            </div>
            <div class="field">
              <span class="field__label">案件类型</span>
              <span class="field__value">{{ caseType }}</span>
            </div>
            <div class="field">
              <span class="field__label">创建时间</span>
              <span class="field__value">{{ formatDateTime(dispute.createdAt) }}</span>
            </div>
            <div class="field">
              <span class="field__label">买家信息</span>
              <a
                v-if="buyerEmail !== '—'"
                class="field__link"
                :href="`mailto:${buyerEmail}`"
              >{{ buyerEmail }}</a>
              <span v-else class="field__value">—</span>
            </div>
            <div class="field">
              <span class="field__label">截止日期</span>
              <span class="field__value">{{ deadlineAt }}</span>
            </div>
            <div class="field">
              <span class="field__label">关联账号</span>
              <button
                type="button"
                class="field__link"
                @click="router.push({ name: 'account-detail', params: { payerId: dispute.payerId } })"
              >
                {{ dispute.payerId || '—' }}
              </button>
            </div>
          </div>

          <div v-if="sellerMustAct" class="seller-alert" role="status">
            <Icon icon="mdi:clock-alert-outline" width="18" />
            <div>
              <strong>等待卖家响应</strong>
              <p>
                请尽快留言协商或提交证据
                <template v-if="deadlineAt !== '—'">（截止 {{ deadlineAt }}）</template>。
              </p>
            </div>
          </div>

          <div v-if="caseActions.length" class="summary__ops">
            <span class="summary__ops-label">处理操作</span>
            <div class="summary__ops-btns">
              <NButton
                v-for="act in caseActions"
                :key="act.key"
                :type="act.primary ? 'primary' : 'default'"
                size="small"
                @click="act.run"
              >
                <template #icon>
                  <Icon :icon="act.icon" width="16" />
                </template>
                {{ act.label }}
              </NButton>
            </div>
          </div>
        </section>

        <section class="body">
          <div class="body__main">
            <div class="tabs" role="tablist">
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'progress' }"
                @click="tab = 'progress'"
              >
                <Icon icon="mdi:timeline-clock-outline" width="16" />
                案件进度
              </button>
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'tx' }"
                @click="tab = 'tx'"
              >
                <Icon icon="mdi:receipt-text-outline" width="16" />
                交易信息
              </button>
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'records' }"
                @click="tab = 'records'"
              >
                <Icon icon="mdi:text-box-outline" width="16" />
                处理记录
              </button>
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'files' }"
                @click="tab = 'files'"
              >
                <Icon icon="mdi:paperclip" width="16" />
                相关文件
              </button>
            </div>

            <div class="pane">
              <div v-if="tab === 'progress'" class="timeline">
                <div
                  v-for="(step, i) in timeline"
                  :key="i"
                  class="timeline__item"
                  :class="{ 'is-done': step.done !== false, 'is-pending': step.done === false }"
                >
                  <div class="timeline__rail" aria-hidden="true">
                    <span class="timeline__dot" />
                    <span v-if="i < timeline.length - 1" class="timeline__line" />
                  </div>
                  <div class="timeline__content">
                    <time class="timeline__time">{{ formatDateTime(step.at) }}</time>
                    <p class="timeline__title">{{ step.title }}</p>
                  </div>
                </div>
              </div>

              <div v-else-if="tab === 'tx'" class="info-block">
                <dl class="kv">
                  <div>
                    <dt>关联交易</dt>
                    <dd>{{ relatedTx }}</dd>
                  </div>
                  <div>
                    <dt>金额</dt>
                    <dd>{{ amountText }}</dd>
                  </div>
                  <div>
                    <dt>商家账号</dt>
                    <dd>{{ dispute.payerId || '—' }}</dd>
                  </div>
                  <div>
                    <dt>原因</dt>
                    <dd>{{ reasonLabel(dispute.reason) }}</dd>
                  </div>
                </dl>
                <NButton
                  type="primary"
                  secondary
                  style="margin-top: 14px"
                  @click="router.push({ name: 'transactions' })"
                >
                  前往交易记录
                </NButton>
              </div>

              <div v-else-if="tab === 'records'" class="info-block">
                <ul v-if="records.length" class="records">
                  <li v-for="(n, i) in records" :key="i">
                    <time>{{ formatDateTime(n.at) }}</time>
                    <strong>{{ n.author || '系统' }}</strong>
                    <p>{{ n.text }}</p>
                    <p v-if="n.documents?.length" class="muted">
                      附件：{{ n.documents.map(doc => doc.name).filter(Boolean).join('、') }}
                    </p>
                  </li>
                </ul>
                <p v-else class="muted">暂无处理记录。添加备注后将显示在此处。</p>
              </div>

              <div v-else class="info-block">
                <ul v-if="evidences.length" class="records">
                  <li v-for="(ev, i) in evidences" :key="i">
                    <strong>{{ evidenceLabel(ev.evidence_type) }}</strong>
                    <p>{{ ev.notes || ev.source || '已提交' }}</p>
                    <p v-if="ev.documents?.length" class="muted">
                      {{ ev.documents.map(doc => doc.name).filter(Boolean).join('、') }}
                    </p>
                  </li>
                </ul>
                <p v-else class="muted">暂无证据。可在案件信息中点击「提交证据」补充说明或物流单号。</p>
              </div>
            </div>
          </div>
        </section>

        <NModal
          :show="dialog === 'message'"
          preset="card"
          :title="dispute && isComplaint(dispute) ? '回应投诉' : '回应争议'"
          class="dlg"
          style="width: 560px"
          @update:show="open => { if (!open) dialog = null }"
        >
          <p class="dlg__hint">
            调查阶段可直接和买家沟通。附件仅支持 JPG / PNG / GIF / PDF，单个不超过 {{ maxEvidenceMb }}MB（PayPal 限制）。
          </p>
          <textarea v-model="messageText" rows="6" placeholder="写给买家的消息，例如补发进度或退款说明" />
          <div class="ops__upload">
            <input
              ref="messageFileInput"
              class="ops__file"
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.pdf,image/jpeg,image/png,image/gif,application/pdf"
              multiple
              @change="onPickMessageFiles"
            />
            <button type="button" class="ops__pick" @click="messageFileInput?.click()">
              <Icon icon="mdi:paperclip" width="16" height="16" />
              添加附件（可选）
            </button>
            <span>最多 {{ MAX_EVIDENCE_FILES }} 个</span>
          </div>
          <ul v-if="messageFiles.length" class="ops__files">
            <li v-for="(file, index) in messageFiles" :key="`${file.name}-${index}`">
              <Icon icon="mdi:file-image-outline" width="16" height="16" />
              <span>{{ file.name }}</span>
              <em>{{ fileSize(file.size) }}</em>
              <button type="button" @click="messageFiles = messageFiles.filter((_, i) => i !== index)">移除</button>
            </li>
          </ul>
          <div class="dlg__foot">
            <NButton @click="dialog = null">取消</NButton>
            <NButton
              type="primary"
              :loading="acting"
              :disabled="!messageText.trim()"
              @click="submitMessage"
            >
              发送消息
            </NButton>
          </div>
        </NModal>

        <NModal :show="dialog === 'evidence'" preset="card" title="提交证据" class="dlg" style="width: 560px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">
            原因：{{ reasonLabel(dispute.reason) }}。按 PayPal 要求选择证据类型；INR 宜附物流妥投，SNAD 宜附商品描述 / 退货政策。
          </p>
          <label class="ops__field">
            <span>证据类型</span>
            <select v-model="evidenceType">
              <option v-for="opt in evidenceTypeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            <em v-if="evidenceTypeHint" class="ops__hint">{{ evidenceTypeHint }}</em>
          </label>
          <label class="ops__field">
            <span>证据说明</span>
            <textarea v-model="evidenceNote" rows="4" placeholder="说明发货、签收或退款情况" />
          </label>
          <label class="ops__field">
            <span>物流单号</span>
            <input v-model="trackingNumber" type="text" placeholder="选填，例如 1Z999AA10123456784" />
          </label>
          <label class="ops__field">
            <span>承运商</span>
            <input v-model="carrierName" type="text" placeholder="选填，如 UPS / FEDEX / OTHER" />
          </label>
          <div class="ops__upload">
            <input
              ref="fileInput"
              class="ops__file"
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.pdf,image/jpeg,image/png,image/gif,application/pdf"
              multiple
              @change="onPickFiles"
            />
            <button type="button" class="ops__pick" @click="fileInput?.click()">
              <Icon icon="mdi:paperclip" width="16" height="16" />
              添加图片或 PDF
            </button>
            <span>单个不超过 {{ maxEvidenceMb }}MB，最多 {{ MAX_EVIDENCE_FILES }} 个</span>
          </div>
          <ul v-if="evidenceFiles.length" class="ops__files">
            <li v-for="(file, index) in evidenceFiles" :key="`${file.name}-${index}`">
              <Icon icon="mdi:file-image-outline" width="16" height="16" />
              <span>{{ file.name }}</span>
              <em>{{ fileSize(file.size) }}</em>
              <button type="button" @click="removeEvidenceFile(index)">移除</button>
            </li>
          </ul>
          <div class="dlg__foot">
            <NButton @click="dialog = null">取消</NButton>
            <NButton
              type="primary"
              :loading="acting"
              :disabled="!evidenceNote.trim() && !trackingNumber.trim() && !evidenceFiles.length"
              @click="submitEvidence"
            >
              提交证据
            </NButton>
          </div>
        </NModal>

        <NModal :show="dialog === 'outcome'" preset="card" title="和解方案" class="dlg" style="width: 560px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">向买家提议退款（make-offer），或直接接受索赔（accept-claim）。</p>
          <template v-if="allow('make-offer')">
            <label class="ops__field">
              <span>提议金额（{{ dispute.amount?.currency_code || 'USD' }}）</span>
              <input v-model="offerAmount" type="text" inputmode="decimal" placeholder="例如 12.00" />
            </label>
            <label class="ops__field">
              <span>说明</span>
              <textarea v-model="offerNote" rows="3" placeholder="写给买家的和解说明" />
            </label>
            <div class="dlg__foot" style="margin-bottom: 12px">
              <NButton
                type="primary"
                :loading="acting"
                :disabled="!offerAmount.trim()"
                @click="
                  runAction('make-offer', {
                    amount: offerAmount.trim(),
                    currency: dispute.amount?.currency_code || 'USD',
                    note: offerNote.trim() || '卖家提议退款'
                  })
                "
              >
                提交提议
              </NButton>
            </div>
          </template>
          <div v-if="allow('accept-claim')" class="ops__choices">
            <button
              type="button"
              class="choice is-danger"
              :disabled="acting"
              @click="runAction('accept-claim', { note: '卖家接受索赔' })"
            >
              <span class="choice__ico">
                <Icon icon="mdi:check" width="18" height="18" />
              </span>
              <span>
                <strong>接受索赔</strong>
                <em>承认责任并退款，关闭案件</em>
              </span>
            </button>
          </div>
        </NModal>

        <NModal :show="dialog === 'escalate'" preset="card" title="升级争议" class="dlg" style="width: 520px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">协商无果时，可将 Inquiry 升级为 Chargeback，交由 PayPal 裁决（escalate）。</p>
          <label class="ops__field">
            <span>升级说明</span>
            <textarea v-model="escalateNote" rows="4" placeholder="说明无法协商解决的原因" />
          </label>
          <div class="dlg__foot">
            <NButton @click="dialog = null">取消</NButton>
            <NButton
              type="primary"
              :loading="acting"
              :disabled="!escalateNote.trim()"
              @click="runAction('escalate', { note: escalateNote.trim() })"
            >
              确认升级
            </NButton>
          </div>
        </NModal>

        <NModal :show="dialog === 'acknowledge'" preset="card" title="确认退货" class="dlg" style="width: 520px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">买家已退货时，向 PayPal 确认是否收到退回商品（acknowledge-return-item）。</p>
          <label class="ops__field">
            <span>确认结果</span>
            <select v-model="acknowledgeType">
              <option value="ITEM_RECEIVED">已收到退货</option>
              <option value="ITEM_NOT_RECEIVED">未收到退货</option>
              <option value="DAMAGED">退货损坏</option>
            </select>
          </label>
          <label class="ops__field">
            <span>说明</span>
            <textarea v-model="acknowledgeNote" rows="4" placeholder="例如：已签收退货并核验包装完好" />
          </label>
          <div class="dlg__foot">
            <NButton @click="dialog = null">取消</NButton>
            <NButton
              type="primary"
              :loading="acting"
              :disabled="!acknowledgeNote.trim()"
              @click="
                runAction('acknowledge-return-item', {
                  note: acknowledgeNote.trim(),
                  acknowledgementType: acknowledgeType
                })
              "
            >
              提交确认
            </NButton>
          </div>
        </NModal>

        <NModal :show="dialog === 'supporting'" preset="card" title="补充说明" class="dlg" style="width: 560px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">
            向 PayPal 补充材料（provide-supporting-info）。附件约束与留言相同：JPG / PNG / GIF / PDF。
          </p>
          <label class="ops__field">
            <span>说明</span>
            <textarea v-model="supportingNote" rows="4" placeholder="补充给 PayPal 的说明" />
          </label>
          <div class="ops__upload">
            <input
              ref="supportingFileInput"
              class="ops__file"
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.pdf,image/jpeg,image/png,image/gif,application/pdf"
              multiple
              @change="onPickSupportingFiles"
            />
            <button type="button" class="ops__pick" @click="supportingFileInput?.click()">
              <Icon icon="mdi:paperclip" width="16" height="16" />
              添加附件（可选）
            </button>
          </div>
          <ul v-if="supportingFiles.length" class="ops__files">
            <li v-for="(file, index) in supportingFiles" :key="`${file.name}-${index}`">
              <Icon icon="mdi:file-image-outline" width="16" height="16" />
              <span>{{ file.name }}</span>
              <em>{{ fileSize(file.size) }}</em>
              <button type="button" @click="supportingFiles = supportingFiles.filter((_, i) => i !== index)">
                移除
              </button>
            </li>
          </ul>
          <div class="dlg__foot">
            <NButton @click="dialog = null">取消</NButton>
            <NButton
              type="primary"
              :loading="acting"
              :disabled="!supportingNote.trim() && !supportingFiles.length"
              @click="submitSupporting"
            >
              提交补充
            </NButton>
          </div>
        </NModal>

        <NModal :show="dialog === 'appeal'" preset="card" title="申诉裁决" class="dlg" style="width: 520px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">对已决结果不满且满足条件时，可提交新证据申诉（appeal）。</p>
          <label class="ops__field">
            <span>申诉说明 / 新证据备注</span>
            <textarea v-model="appealNote" rows="4" placeholder="说明申诉理由，并可随后再走「提交证据」补附件" />
          </label>
          <div class="dlg__foot">
            <NButton @click="dialog = null">取消</NButton>
            <NButton
              type="primary"
              :loading="acting"
              :disabled="!appealNote.trim()"
              @click="runAction('appeal', { note: appealNote.trim() })"
            >
              提交申诉
            </NButton>
          </div>
        </NModal>
      </template>

      <PpEmptyState
        v-else-if="!loading"
        icon="mdi:file-search-outline"
        title="未找到该案件"
        description="案件可能尚未同步，或 ID 不正确。"
      >
        <template #actions>
          <NButton type="primary" @click="router.push(listRoute)">返回列表</NButton>
        </template>
      </PpEmptyState>
    </PpAsyncPane>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 14px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pp-blue);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 550;
  cursor: pointer;
}

.summary {
  padding: 20px 22px 0;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  margin-bottom: 14px;
  overflow: hidden;
}

.summary__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.summary__id {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #003087;
}

.summary__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 32px;
  padding-bottom: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field__label {
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.field__value {
  font-size: 0.9rem;
  color: var(--pp-text);
  word-break: break-word;
}

.field__value--strong {
  font-weight: 700;
}

.field__value.is-alert {
  color: #dc2626;
  font-weight: 650;
}

.field__link {
  display: inline;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pp-blue);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 550;
  text-align: left;
  cursor: pointer;
  word-break: break-all;
}

.field__link:hover {
  text-decoration: underline;
}

.seller-alert {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 16px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #f5c26b;
  background: #fff8eb;
  color: #92400e;
}

.seller-alert strong {
  display: block;
  font-size: 0.9rem;
}

.seller-alert p {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: #a16207;
}

.summary__ops {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  margin: 18px -22px 0;
  padding: 12px 22px;
  border-top: 1px solid var(--pp-border);
  background: #f7f9fc;
}

.summary__ops-label {
  flex: none;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--pp-muted);
}

.summary__ops-btns {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.body {
  display: block;
}

.body__main {
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  overflow: hidden;
  min-width: 0;
}

.tabs {
  display: flex;
  gap: 6px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--pp-border);
  background: #f7f9fc;
  overflow-x: auto;
}

.tabs__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-bottom: -1px;
  padding: 9px 14px 11px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  background: transparent;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 550;
  color: var(--pp-muted);
  cursor: pointer;
}

.tabs__item:hover {
  color: var(--pp-text);
  background: rgba(255, 255, 255, 0.7);
}

.tabs__item.is-active {
  color: var(--pp-blue-deep);
  font-weight: 650;
  background: #fff;
  border-color: var(--pp-border);
}

.pane {
  padding: 22px 24px 28px;
  min-height: 280px;
}

.timeline {
  display: flex;
  flex-direction: column;
  max-width: 520px;
}

.timeline__item {
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 14px;
  min-height: 64px;
}

.timeline__rail {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.timeline__dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--pp-blue);
  border: 2px solid #fff;
  box-shadow: 0 0 0 2px var(--pp-blue);
  flex-shrink: 0;
  margin-top: 4px;
  z-index: 1;
}

.timeline__item.is-pending .timeline__dot {
  background: #fff;
  box-shadow: 0 0 0 2px #94a3b8;
}

.timeline__line {
  flex: 1;
  width: 2px;
  margin: 4px 0 0;
  background: #c5d6ea;
  min-height: 36px;
}

.timeline__content {
  padding-bottom: 18px;
}

.timeline__time {
  display: block;
  font-size: 0.75rem;
  color: var(--pp-muted);
  font-variant-numeric: tabular-nums;
}

.timeline__title {
  margin: 4px 0 0;
  font-size: 0.925rem;
  font-weight: 600;
  color: var(--pp-text);
}

.timeline__item.is-pending .timeline__title {
  color: var(--pp-muted);
  font-weight: 500;
}

.kv {
  margin: 0;
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  overflow: hidden;
}

.kv > div {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #eef1f6;
  font-size: 0.875rem;
}

.kv > div:last-child {
  border-bottom: none;
}

.kv dt {
  margin: 0;
  color: var(--pp-muted);
}

.kv dd {
  margin: 0;
  word-break: break-word;
}

.records {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.records li {
  padding: 12px 14px;
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  background: #fafbfc;
}

.records time {
  display: block;
  font-size: 0.72rem;
  color: var(--pp-muted);
}

.records strong {
  display: block;
  margin-top: 4px;
  font-size: 0.84rem;
}

.records p {
  margin: 6px 0 0;
  font-size: 0.875rem;
  color: var(--pp-text);
  line-height: 1.5;
}

.muted {
  margin: 0;
  font-size: 0.875rem;
  color: var(--pp-muted);
}

.ops {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.ops__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 14px;
  box-shadow: var(--pp-shadow);
}

.ops__mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 12px;
  color: #fff;
  background: var(--pp-blue-deep);
}

.ops__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.ops__hint {
  margin: 4px 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--pp-muted);
}

.ops__block {
  padding: 16px 18px 18px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 14px;
  box-shadow: var(--pp-shadow);
}

.ops__block-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
}

.ops__block-head h3 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
}

.ops__block-head p {
  margin: 3px 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--pp-muted);
}

.ops__ico {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  margin-top: 1px;
  border-radius: 8px;
  color: var(--pp-blue-deep);
  background: var(--pp-blue-soft);
}

.ops__block > textarea,
.ops__field textarea,
.ops__field input,
.ops__field select {
  width: 100%;
  padding: 12px 12px;
  border: 1px solid var(--pp-border);
  border-radius: 10px;
  background: #f8fafc;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 450;
  line-height: 1.5;
  color: var(--pp-text);
  resize: vertical;
}

.ops__block > textarea:focus,
.ops__field textarea:focus,
.ops__field input:focus,
.ops__field select:focus {
  outline: none;
  border-color: #8eb4d6;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.12);
}

.ops__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 0.75rem;
  font-weight: 650;
  color: var(--pp-muted);
}

.ops__hint {
  font-style: normal;
  font-weight: 450;
  font-size: 0.75rem;
  color: #64748b;
  line-height: 1.4;
}

.ops__upload {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.ops__upload > span {
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.ops__file {
  display: none;
}

.ops__pick {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px dashed #b7c9de;
  border-radius: 10px;
  background: #f8fafc;
  color: var(--pp-blue-deep);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 650;
  cursor: pointer;
}

.ops__pick:hover {
  background: #f3f8fc;
  border-color: var(--pp-blue);
}

.ops__files {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.ops__files li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--pp-border);
  font-size: 0.82rem;
}

.ops__files span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ops__files em {
  flex: none;
  font-style: normal;
  color: var(--pp-muted);
}

.ops__files button {
  flex: none;
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pp-blue);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.ops__submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 12px;
  padding: 11px 14px;
  border: 0;
  border-radius: 10px;
  background: var(--pp-blue);
  color: #fff;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 650;
  cursor: pointer;
}

.ops__submit:hover:not(:disabled) {
  background: var(--pp-blue-hover);
}

.ops__submit.is-ghost {
  background: #fff;
  color: var(--pp-blue-deep);
  border: 1px solid #c5d7ea;
}

.ops__submit.is-ghost:hover:not(:disabled) {
  background: #f3f8fc;
}

.ops__submit:disabled,
.choice:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ops__choices {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.choice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 76px;
  padding: 12px;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  background: #fff;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.choice:hover:not(:disabled) {
  border-color: #b7c9de;
  background: #f5f8fc;
}

.choice strong,
.choice em {
  display: block;
}

.choice strong {
  font-size: 0.84rem;
  font-weight: 700;
  font-style: normal;
  color: var(--pp-text);
}

.choice em {
  margin-top: 4px;
  font-size: 0.75rem;
  font-style: normal;
  line-height: 1.35;
  color: var(--pp-muted);
}

.choice__ico {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 9px;
  color: var(--pp-blue-deep);
  background: var(--pp-blue-soft);
}

.choice.is-danger {
  border-color: #f3d0d0;
}

.choice.is-danger:hover:not(:disabled) {
  background: #fff6f6;
  border-color: #e8b4b4;
}

.choice.is-danger .choice__ico {
  color: #b42318;
  background: #fdecec;
}

.choice.is-danger strong {
  color: #b42318;
}

.dlg__hint {
  margin: 0 0 14px;
  color: var(--pp-muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.dlg textarea,
.dlg input[type='text'] {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 0.9rem;
  color: var(--pp-text);
  resize: vertical;
}

.dlg textarea:focus,
.dlg input[type='text']:focus {
  outline: none;
  border-color: var(--pp-blue);
}

.dlg__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

@media (max-width: 1100px) {
  .summary__grid {
    grid-template-columns: 1fr;
  }
}
</style>
