<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useMessage } from 'naive-ui';
import { enrichCartImages } from '@/api/paypal';
import type { TransactionItem } from '@/api/types';
import { formatDateTime } from '@/lib/format';
import {
  formatAmountObj,
  txAmountNumber,
  txCounterparty,
  txCounterpartyName,
  txEventLabel,
  txInfo,
  txInitiatedAt,
  txStatusMeta,
  txSubject
} from '@/lib/transaction';

const props = defineProps<{
  open: boolean;
  payerId: string;
  email?: string;
  tx: TransactionItem | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const router = useRouter();
const message = useMessage();
const imageLoading = ref(false);
const imageByIndex = ref<Record<number, string>>({});

const info = computed(() => (props.tx ? txInfo(props.tx) : {}));
const payer = computed(() => props.tx?.payer_info);
const shipping = computed(() => props.tx?.shipping_info);
const cart = computed(() => props.tx?.cart_info?.item_details || []);

const cartRows = computed(() =>
  cart.value.map((item, index) => ({
    ...item,
    imageUrl: imageByIndex.value[index] || item.imageUrl || null
  }))
);

const amountTone = computed(() => {
  if (!props.tx) return '';
  const n = txAmountNumber(props.tx);
  if (n > 0) return 'is-in';
  if (n < 0) return 'is-out';
  return '';
});

const status = computed(() => txStatusMeta(info.value.transaction_status));

function badgeTone(type: string) {
  if (type === 'success') return 'ok';
  if (type === 'warning') return 'warn';
  if (type === 'error') return 'bad';
  if (type === 'info') return 'info';
  return 'mute';
}

const payerName = computed(() => {
  if (!payer.value) return '';
  return txCounterpartyName({ payer_info: payer.value } as TransactionItem);
});

const shippingAddress = computed(() => {
  const a = shipping.value?.address;
  if (!a) return '';
  return [a.line1, a.line2, a.city, a.state, a.postal_code, a.country_code].filter(Boolean).join(', ');
});

const instrument = computed(() =>
  [info.value.instrument_type, info.value.instrument_sub_type].filter(Boolean).join(' · ')
);

async function loadCartImages() {
  imageByIndex.value = {};
  if (!props.open || !props.tx || !props.payerId || !cart.value.length) return;

  imageLoading.value = true;
  try {
    const res = await enrichCartImages(props.payerId, {
      customField: info.value.custom_field || '',
      invoiceId: info.value.invoice_id || '',
      items: cart.value.map(item => ({
        item_code: item.item_code,
        item_name: item.item_name,
        item_description: item.item_description,
        invoice_number: item.invoice_number
      }))
    });
    const next: Record<number, string> = {};
    (res.items || []).forEach((row, index) => {
      if (row.imageUrl) next[index] = row.imageUrl;
    });
    imageByIndex.value = next;
  } catch {
    /* 订单服务未就绪时静默失败，仍展示无图商品明细 */
  } finally {
    imageLoading.value = false;
  }
}

watch(
  () => [props.open, props.payerId, props.tx] as const,
  ([open]) => {
    if (open) void loadCartImages();
    else imageByIndex.value = {};
  }
);

async function copyText(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.warning('复制失败');
  }
}

function goAccount() {
  emit('close');
  void router.push({ name: 'account-detail', params: { payerId: props.payerId } });
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open && tx" class="drawer" @click.self="emit('close')">
        <aside class="drawer__panel" role="dialog" aria-modal="true" aria-label="交易详情">
          <header class="drawer__head">
            <h2 class="drawer__title">交易详情</h2>
            <button type="button" class="drawer__close" aria-label="关闭" @click="emit('close')">
              <Icon icon="mdi:close" width="18" />
            </button>
          </header>

          <div class="hero" :class="amountTone">
            <div class="hero__amt">{{ formatAmountObj(info.transaction_amount) }}</div>
            <div class="hero__meta">
              <span class="pp-badge" :class="`pp-badge--${badgeTone(status.type)}`">{{ status.label }}</span>
              <span class="hero__event">{{ txEventLabel(info.transaction_event_code) }}</span>
            </div>
            <p v-if="txSubject(tx) !== '—'" class="hero__sub">{{ txSubject(tx) }}</p>
            <button
              type="button"
              class="hero__id"
              @click="copyText(info.transaction_id || '')"
            >
              <span class="mono">{{ info.transaction_id || '—' }}</span>
              <Icon icon="mdi:content-copy" width="14" />
            </button>
          </div>

          <section class="block">
            <h3 class="block__title">交易信息</h3>
            <dl class="kv">
              <div>
                <dt>交易 ID</dt>
                <dd>
                  <button type="button" class="copy" @click="copyText(info.transaction_id || '')">
                    <span class="mono">{{ info.transaction_id || '—' }}</span>
                    <Icon icon="mdi:content-copy" width="14" />
                  </button>
                </dd>
              </div>
              <div>
                <dt>事件代码</dt>
                <dd>
                  <span class="mono">{{ info.transaction_event_code || '—' }}</span>
                  <em v-if="info.transaction_event_code">{{ txEventLabel(info.transaction_event_code) }}</em>
                </dd>
              </div>
              <div>
                <dt>状态码</dt>
                <dd>
                  <span class="mono">{{ info.transaction_status || '—' }}</span>
                  · {{ status.label }}
                </dd>
              </div>
              <div>
                <dt>发起时间</dt>
                <dd>{{ txInitiatedAt(tx) }}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{{ formatDateTime(info.transaction_updated_date) }}</dd>
              </div>
              <div>
                <dt>交易金额</dt>
                <dd :class="amountTone">{{ formatAmountObj(info.transaction_amount) }}</dd>
              </div>
              <div>
                <dt>手续费</dt>
                <dd>{{ formatAmountObj(info.fee_amount) }}</dd>
              </div>
              <div>
                <dt>运费</dt>
                <dd>{{ formatAmountObj(info.shipping_amount) }}</dd>
              </div>
              <div>
                <dt>支付工具</dt>
                <dd>{{ instrument || '—' }}</dd>
              </div>
              <div>
                <dt>买家保护</dt>
                <dd>{{ info.protection_eligibility || '—' }}</dd>
              </div>
              <div>
                <dt>发票号</dt>
                <dd>
                  <button
                    v-if="info.invoice_id"
                    type="button"
                    class="copy"
                    @click="copyText(info.invoice_id)"
                  >
                    <span class="mono">{{ info.invoice_id }}</span>
                    <Icon icon="mdi:content-copy" width="14" />
                  </button>
                  <template v-else>—</template>
                </dd>
              </div>
              <div>
                <dt>参考号</dt>
                <dd>
                  <template v-if="info.paypal_reference_id">
                    <button type="button" class="copy" @click="copyText(info.paypal_reference_id || '')">
                      <span class="mono">{{ info.paypal_reference_id }}</span>
                      <Icon icon="mdi:content-copy" width="14" />
                    </button>
                    <em v-if="info.paypal_reference_id_type">{{ info.paypal_reference_id_type }}</em>
                  </template>
                  <template v-else>—</template>
                </dd>
              </div>
              <div>
                <dt>自定义字段</dt>
                <dd class="wrap">{{ info.custom_field || '—' }}</dd>
              </div>
              <div>
                <dt>PayPal 账号 ID</dt>
                <dd class="mono">{{ info.paypal_account_id || '—' }}</dd>
              </div>
              <div>
                <dt>摘要</dt>
                <dd class="wrap">{{ info.transaction_subject || '—' }}</dd>
              </div>
            </dl>
          </section>

          <section class="block">
            <h3 class="block__title">商家账号</h3>
            <dl class="kv">
              <div>
                <dt>邮箱</dt>
                <dd>
                  <button v-if="email || payerId" type="button" class="link" @click="goAccount">
                    {{ email || payerId }}
                  </button>
                  <template v-else>—</template>
                </dd>
              </div>
              <div>
                <dt>Payer ID</dt>
                <dd>
                  <button type="button" class="copy" @click="copyText(payerId)">
                    <span class="mono">{{ payerId }}</span>
                    <Icon icon="mdi:content-copy" width="14" />
                  </button>
                </dd>
              </div>
            </dl>
          </section>

          <section class="block">
            <h3 class="block__title">付款方 / 对方</h3>
            <dl v-if="payer" class="kv">
              <div>
                <dt>显示名</dt>
                <dd>{{ txCounterparty(tx) }}</dd>
              </div>
              <div>
                <dt>姓名</dt>
                <dd>{{ payerName || '—' }}</dd>
              </div>
              <div>
                <dt>邮箱</dt>
                <dd>
                  <button
                    v-if="payer.email_address"
                    type="button"
                    class="copy"
                    @click="copyText(payer.email_address)"
                  >
                    {{ payer.email_address }}
                    <Icon icon="mdi:content-copy" width="14" />
                  </button>
                  <template v-else>—</template>
                </dd>
              </div>
              <div>
                <dt>Account ID</dt>
                <dd class="mono">{{ payer.account_id || '—' }}</dd>
              </div>
              <div>
                <dt>国家</dt>
                <dd>{{ payer.country_code || '—' }}</dd>
              </div>
              <div>
                <dt>付款人状态</dt>
                <dd>{{ payer.payer_status || '—' }}</dd>
              </div>
              <div>
                <dt>地址状态</dt>
                <dd>{{ payer.address_status || '—' }}</dd>
              </div>
            </dl>
            <p v-else class="empty-hint">暂无付款方信息</p>
          </section>

          <section class="block">
            <h3 class="block__title">收货信息</h3>
            <dl v-if="shipping?.name || shippingAddress" class="kv">
              <div>
                <dt>收件人</dt>
                <dd>{{ shipping?.name || '—' }}</dd>
              </div>
              <div>
                <dt>地址</dt>
                <dd class="wrap">{{ shippingAddress || '—' }}</dd>
              </div>
              <div v-if="shipping?.address">
                <dt>城市 / 州</dt>
                <dd>
                  {{ [shipping.address.city, shipping.address.state].filter(Boolean).join(', ') || '—' }}
                </dd>
              </div>
              <div v-if="shipping?.address">
                <dt>邮编</dt>
                <dd>{{ shipping.address.postal_code || '—' }}</dd>
              </div>
              <div v-if="shipping?.address">
                <dt>国家</dt>
                <dd>{{ shipping.address.country_code || '—' }}</dd>
              </div>
            </dl>
            <p v-else class="empty-hint">暂无收货信息</p>
          </section>

          <section class="block">
            <h3 class="block__title">
              商品明细
              <span v-if="imageLoading" class="block__hint">补全图片中…</span>
            </h3>
            <div v-if="cartRows.length" class="cart">
              <div v-for="(item, idx) in cartRows" :key="idx" class="cart__item">
                <div class="cart__top">
                  <div class="cart__thumb" aria-hidden="true">
                    <img v-if="item.imageUrl" :src="item.imageUrl" :alt="item.item_name || '商品图'" />
                    <Icon v-else icon="mdi:image-off-outline" width="22" />
                  </div>
                  <div class="cart__name">
                    <strong>{{ item.item_name || `商品 ${idx + 1}` }}</strong>
                    <span v-if="item.item_description">{{ item.item_description }}</span>
                    <span v-if="item.item_code" class="cart__sku">SKU {{ item.item_code }}</span>
                  </div>
                </div>
                <dl class="kv kv--compact">
                  <div>
                    <dt>数量</dt>
                    <dd>{{ item.item_quantity || '—' }}</dd>
                  </div>
                  <div>
                    <dt>单价</dt>
                    <dd>{{ formatAmountObj(item.item_unit_price) }}</dd>
                  </div>
                  <div>
                    <dt>小计</dt>
                    <dd>{{ formatAmountObj(item.item_amount || item.total_item_amount) }}</dd>
                  </div>
                  <div v-if="item.invoice_number">
                    <dt>发票</dt>
                    <dd class="mono">{{ item.invoice_number }}</dd>
                  </div>
                </dl>
              </div>
            </div>
            <p v-else class="empty-hint">暂无商品明细</p>
          </section>

        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 30, 50, 0.4);
  display: flex;
  justify-content: flex-end;
}

.drawer__panel {
  width: min(520px, 100%);
  height: 100%;
  background: #fff;
  box-shadow: -8px 0 32px rgba(15, 30, 50, 0.14);
  overflow: auto;
  padding: 0 0 40px;
}

.drawer__head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: #fff;
  border-bottom: 1px solid var(--pp-border);
}

.drawer__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.drawer__close {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--pp-border);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  color: var(--pp-muted);
}

.hero {
  margin: 16px 20px 0;
  padding: 18px 18px 14px;
  border-radius: 12px;
  background: #f7f9fc;
  border: 1px solid var(--pp-border);
}

.hero__amt {
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
}

.hero.is-in .hero__amt {
  color: #15803d;
}

.hero.is-out .hero__amt {
  color: #b91c1c;
}

.hero__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.hero__event {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--pp-text);
}

.hero__sub {
  margin: 10px 0 0;
  font-size: 0.84rem;
  color: var(--pp-muted);
  line-height: 1.45;
}

.hero__id {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: #fff;
  color: var(--pp-muted);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.hero__id:hover {
  color: var(--pp-blue);
}

.block {
  padding: 18px 20px 0;
}

.block__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--pp-muted);
}

.block__hint {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: #93a1b4;
}

.kv {
  margin: 0;
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  overflow: hidden;
}

.kv > div {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid #eef1f6;
  font-size: 0.84rem;
}

.kv > div:last-child {
  border-bottom: none;
}

.kv--compact > div {
  grid-template-columns: 64px minmax(0, 1fr);
  padding: 6px 10px;
}

.kv dt {
  margin: 0;
  color: var(--pp-muted);
}

.kv dd {
  margin: 0;
  color: var(--pp-text);
  word-break: break-word;
}

.kv dd.wrap {
  white-space: pre-wrap;
}

.kv dd.is-in {
  color: #15803d;
  font-weight: 650;
}

.kv dd.is-out {
  color: #b91c1c;
  font-weight: 650;
}

.kv em {
  margin-left: 6px;
  font-style: normal;
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
}

.copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--pp-blue);
  font: inherit;
  cursor: pointer;
  text-align: left;
  max-width: 100%;
}

.copy:hover {
  text-decoration: underline;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--pp-blue);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.link:hover {
  text-decoration: underline;
}

.empty-hint {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--pp-border);
  border-radius: 8px;
  font-size: 0.8125rem;
  color: var(--pp-muted);
  text-align: center;
  background: #fafbfc;
}

.cart {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cart__item {
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  overflow: hidden;
}

.cart__top {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  background: #f7f9fc;
  border-bottom: 1px solid var(--pp-border);
}

.cart__thumb {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #e8eef6;
  color: #93a1b4;
  border: 1px solid var(--pp-border);
}

.cart__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cart__name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-top: 2px;
}

.cart__name strong {
  font-size: 0.875rem;
  line-height: 1.35;
}

.cart__name span {
  font-size: 0.75rem;
  color: var(--pp-muted);
}

.cart__sku {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.cart__item .kv {
  border: 0;
  border-radius: 0;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-enter-active .drawer__panel,
.drawer-leave-active .drawer__panel {
  transition: transform 0.22s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .drawer__panel,
.drawer-leave-to .drawer__panel {
  transform: translateX(28px);
}
</style>
