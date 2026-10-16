<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NModal, NSpin, useMessage } from 'naive-ui';
import PpEmptyState from '@/components/PpEmptyState.vue';
import { actOnDispute, fetchDispute, provideEvidence } from '@/api/paypal';
import type { DisputeItem } from '@/api/types';
import { evidenceLabel, reasonLabel, stageLabel } from '@/lib/dispute';
import { formatDateTime } from '@/lib/format';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const loading = ref(true);
const acting = ref(false);
const dispute = ref<DisputeItem | null>(null);
const tab = ref<'progress' | 'tx' | 'records' | 'files'>('progress');
const dialog = ref<'message' | 'evidence' | 'outcome' | null>(null);
const messageText = ref('');
const evidenceNote = ref('');
const trackingNumber = ref('');
const evidenceFiles = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

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
  return [
    { at: created, title: '买家提出争议', done: true },
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

async function runAction(
  action: 'send-message' | 'provide-evidence' | 'make-offer' | 'accept-claim',
  body: Record<string, unknown>
) {
  if (!dispute.value || acting.value) return;
  acting.value = true;
  try {
    dispute.value = await actOnDispute(dispute.value.id, action, body);
    message.success(dispute.value.sample ? '已更新示例案件' : '已提交到 PayPal');
    dialog.value = null;
    messageText.value = '';
    evidenceNote.value = '';
    trackingNumber.value = '';
    evidenceFiles.value = [];
  } catch (err) {
    message.error(err instanceof Error ? err.message : '操作失败');
  } finally {
    acting.value = false;
  }
}

function onPickFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const next = [...evidenceFiles.value];
  for (const file of Array.from(input.files || [])) {
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
  evidenceFiles.value = next;
  input.value = '';
}

function removeEvidenceFile(index: number) {
  evidenceFiles.value = evidenceFiles.value.filter((_, i) => i !== index);
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function submitEvidence() {
  if (!dispute.value || acting.value) return;
  if (!evidenceNote.value.trim() && !trackingNumber.value.trim() && !evidenceFiles.value.length) return;
  acting.value = true;
  try {
    dispute.value = await provideEvidence(dispute.value.id, {
      notes: evidenceNote.value.trim(),
      trackingNumber: trackingNumber.value.trim(),
      files: evidenceFiles.value
    });
    message.success(dispute.value.sample ? '已更新示例案件' : '已提交到 PayPal');
    dialog.value = null;
    evidenceNote.value = '';
    trackingNumber.value = '';
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
    <button type="button" class="back" @click="router.push({ name: 'disputes' })">
      <Icon icon="mdi:arrow-left" width="16" />
      返回争议列表
    </button>

    <NSpin :show="loading">
      <template v-if="dispute">
        <section class="summary">
          <div class="summary__head">
            <h1 class="summary__id">{{ dispute.id }}</h1>
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
        </section>

        <div class="action-bar">
          <button type="button" class="action-card" @click="dialog = 'message'">
            <span class="action-card__ico">
              <Icon icon="mdi:message-reply-text" width="22" height="22" />
            </span>
            <span class="action-card__text">
              <strong>回应争议</strong>
              <em>给买家发送说明</em>
            </span>
            <span class="action-card__go">
              点击进入
              <Icon icon="mdi:chevron-right" width="18" height="18" />
            </span>
          </button>
          <button type="button" class="action-card" @click="dialog = 'evidence'">
            <span class="action-card__ico is-file">
              <Icon icon="mdi:file-upload" width="22" height="22" />
            </span>
            <span class="action-card__text">
              <strong>提交证据</strong>
              <em>说明、物流单号或附件</em>
            </span>
            <span class="action-card__go">
              点击进入
              <Icon icon="mdi:chevron-right" width="18" height="18" />
            </span>
          </button>
          <button type="button" class="action-card" @click="dialog = 'outcome'">
            <span class="action-card__ico is-result">
              <Icon icon="mdi:gavel" width="22" height="22" />
            </span>
            <span class="action-card__text">
              <strong>处理结果</strong>
              <em>提议退款或接受索赔</em>
            </span>
            <span class="action-card__go">
              点击进入
              <Icon icon="mdi:chevron-right" width="18" height="18" />
            </span>
          </button>
        </div>

        <section class="body">
          <div class="body__main">
            <div class="tabs" role="tablist">
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'progress' }"
                @click="tab = 'progress'"
              >
                案件进度
              </button>
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'tx' }"
                @click="tab = 'tx'"
              >
                交易信息
              </button>
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'records' }"
                @click="tab = 'records'"
              >
                处理记录
              </button>
              <button
                type="button"
                class="tabs__item"
                :class="{ 'is-active': tab === 'files' }"
                @click="tab = 'files'"
              >
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
                <p v-else class="muted">暂无证据。可点击上方「提交证据」补充说明或物流单号。</p>
              </div>
            </div>
          </div>
        </section>

        <NModal :show="dialog === 'message'" preset="card" title="回应争议" class="dlg" style="width: 560px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">调查阶段可直接和买家沟通，说明发货或退款安排。</p>
          <textarea v-model="messageText" rows="6" placeholder="写给买家的消息，例如补发进度或退款说明" />
          <div class="dlg__foot">
            <NButton @click="dialog = null">取消</NButton>
            <NButton
              type="primary"
              :loading="acting"
              :disabled="!messageText.trim()"
              @click="runAction('send-message', { message: messageText.trim() })"
            >
              发送消息
            </NButton>
          </div>
        </NModal>

        <NModal :show="dialog === 'evidence'" preset="card" title="提交证据" class="dlg" style="width: 560px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">可写说明、物流单号，或上传 JPG、PNG、GIF、PDF。</p>
          <label class="ops__field">
            <span>证据说明</span>
            <textarea v-model="evidenceNote" rows="4" placeholder="说明发货、签收或退款情况" />
          </label>
          <label class="ops__field">
            <span>物流单号</span>
            <input v-model="trackingNumber" type="text" placeholder="选填，例如 1Z999AA10123456784" />
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

        <NModal :show="dialog === 'outcome'" preset="card" title="处理结果" class="dlg" style="width: 520px" @update:show="open => { if (!open) dialog = null }">
          <p class="dlg__hint">主动和解，或接受买家索赔。</p>
          <div class="ops__choices">
            <button
              type="button"
              class="choice"
              :disabled="acting"
              @click="runAction('make-offer', { amount: dispute.amount?.value, currency: dispute.amount?.currency_code, note: '卖家提议全额退款' })"
            >
              <span class="choice__ico">
                <Icon icon="mdi:cash-refund" width="18" height="18" />
              </span>
              <span>
                <strong>提议全额退款</strong>
                <em>{{ amountText }}</em>
              </span>
            </button>
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
                <em>承认责任并完成退款</em>
              </span>
            </button>
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
          <NButton type="primary" @click="router.push({ name: 'disputes' })">返回列表</NButton>
        </template>
      </PpEmptyState>
    </NSpin>
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
  padding: 20px 22px;
  background: #fff;
  border: 1px solid var(--pp-border);
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  margin-bottom: 14px;
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

.action-bar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.action-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 16px;
  text-align: left;
  background: #fff;
  border: 1px solid #d5e2f2;
  border-radius: 12px;
  box-shadow: var(--pp-shadow);
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.action-card:hover {
  border-color: #7aa7e8;
  box-shadow: 0 8px 20px rgba(0, 48, 135, 0.1);
  transform: translateY(-1px);
}

.action-card:hover .action-card__go {
  color: #003087;
  background: #e7f0fb;
}

.action-card:hover .action-card__go svg {
  transform: translateX(2px);
}

.action-card__text {
  flex: 1;
  min-width: 0;
}

.action-card strong {
  display: block;
  font-size: 0.95rem;
  font-weight: 700;
  color: #003087;
}

.action-card em {
  display: block;
  margin-top: 3px;
  font-style: normal;
  font-size: 0.78rem;
  color: var(--pp-muted);
}

.action-card__ico {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 12px;
  color: #fff;
  background: #0070ba;
}

.action-card__ico.is-file {
  background: #0f766e;
}

.action-card__ico.is-result {
  background: #b45309;
}

.action-card__go {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  height: 28px;
  padding: 0 8px 0 10px;
  border-radius: 999px;
  background: #f3f6fb;
  color: #5b6b82;
  font-size: 0.75rem;
  font-weight: 650;
}

.action-card__go svg {
  transition: transform 0.15s ease;
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
  gap: 0;
  padding: 0 8px;
  border-bottom: 1px solid var(--pp-border);
  overflow-x: auto;
}

.tabs__item {
  position: relative;
  flex-shrink: 0;
  padding: 14px 16px;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 550;
  color: var(--pp-muted);
  cursor: pointer;
}

.tabs__item.is-active {
  color: var(--pp-blue);
  font-weight: 650;
}

.tabs__item.is-active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--pp-blue);
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
.ops__field input {
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
.ops__field input:focus {
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
  .summary__grid,
  .action-bar {
    grid-template-columns: 1fr;
  }
}
</style>
