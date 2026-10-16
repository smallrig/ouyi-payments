<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { NButton, NDataTable, NTabs, NTabPane, useMessage, type DataTableColumns } from 'naive-ui';
import PpEmptyState from '@/components/PpEmptyState.vue';
import { useClientPagination } from '@/composables/useClientPagination';
import { fetchApiLogs, fetchWebhooks } from '@/api/paypal';
import type { ApiLogItem, WebhookItem } from '@/api/types';
import { formatDateTime } from '@/lib/format';

const message = useMessage();
const webhookUrl = import.meta.env.VITE_PAYPAL_WEBHOOK_URL || '';
const loadingWebhooks = ref(false);
const loadingLogs = ref(false);
const webhooks = ref<WebhookItem[]>([]);
const logs = ref<ApiLogItem[]>([]);

const webhookPager = useClientPagination(webhooks, 10);
const logPager = useClientPagination(logs, 10);
const webhookPagination = computed(() => webhookPager.tablePagination());
const logPagination = computed(() => logPager.tablePagination());

const webhookColumns: DataTableColumns<WebhookItem> = [
  { title: 'ID', key: 'id', width: 100 },
  { title: '接收时间', key: 'receivedAt', render: r => formatDateTime(r.receivedAt) },
  {
    title: 'Transmission ID',
    key: 'transmission',
    render: r => r.headers?.['paypal-transmission-id'] || '—'
  },
  {
    title: '事件摘要',
    key: 'event',
    ellipsis: { tooltip: true },
    render: row => {
      const ev = row.event as { event_type?: string; id?: string } | undefined;
      return ev?.event_type || JSON.stringify(row.event).slice(0, 80);
    }
  }
];

const logColumns: DataTableColumns<ApiLogItem> = [
  { title: '方法', key: 'method', width: 72 },
  { title: '路径', key: 'path', ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 72 },
  { title: '用户', key: 'userId', width: 100, render: r => r.userId || '—' },
  { title: 'Payer', key: 'payerId', width: 100, render: r => r.payerId || '—' },
  { title: '耗时 ms', key: 'ms', width: 88 },
  {
    title: '时间',
    key: 'at',
    width: 160,
    render: row => formatDateTime(row.at)
  }
];

async function loadWebhooks() {
  loadingWebhooks.value = true;
  try {
    webhooks.value = await fetchWebhooks(200);
    webhookPager.resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载 Webhook 失败');
  } finally {
    loadingWebhooks.value = false;
  }
}

async function loadLogs() {
  loadingLogs.value = true;
  try {
    logs.value = await fetchApiLogs(200);
    logPager.resetPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载 API 日志失败');
  } finally {
    loadingLogs.value = false;
  }
}

onMounted(() => {
  void loadWebhooks();
  void loadLogs();
});
</script>

<template>
  <div class="pp-page">
    <div class="pp-page-head">
      <div>
        <p class="pp-page-eyebrow">Ops</p>
        <h1 class="pp-page-title">Webhook 与日志</h1>
        <p class="pp-page-desc">Webhook 自动同步 PayPal 事件；API 日志记录管理端调用（不含密钥）。</p>
      </div>
    </div>

    <NTabs type="line" animated>
      <NTabPane name="webhooks" tab="Webhook">
        <div class="tab-toolbar">
          <NButton size="small" @click="loadWebhooks">刷新</NButton>
        </div>
        <NDataTable
          :columns="webhookColumns"
          :data="webhooks"
          :loading="loadingWebhooks"
          :pagination="webhookPagination"
          class="pp-panel"
          :bordered="false"
        >
          <template #empty>
            <PpEmptyState
              compact
              icon="mdi:webhook"
              float-a="mdi:lightning-bolt-outline"
              float-b="mdi:cloud-outline"
              title="还没有 Webhook 事件"
              description="在 PayPal Developer 控制台将通知 URL 指向本服务，支付与争议事件会自动落在此列表。"
            >
              <template #steps>
                <ol class="pp-empty__steps">
                  <li>
                    <span class="pp-empty__step-num">1</span>
                    <div>
                      <strong>配置通知 URL</strong>
                      <span>POST {{ webhookUrl }}</span>
                    </div>
                  </li>
                  <li>
                    <span class="pp-empty__step-num">2</span>
                    <div>
                      <strong>勾选事件类型</strong>
                      <span>如支付完成、争议创建等</span>
                    </div>
                  </li>
                  <li>
                    <span class="pp-empty__step-num">3</span>
                    <div>
                      <strong>触发后点刷新</strong>
                      <span>事件摘要会出现在本页</span>
                    </div>
                  </li>
                </ol>
              </template>
              <template #actions>
                <NButton type="primary" strong secondary @click="loadWebhooks">
                  <template #icon><Icon icon="mdi:refresh" width="18" /></template>
                  刷新列表
                </NButton>
              </template>
            </PpEmptyState>
          </template>
        </NDataTable>
      </NTabPane>
      <NTabPane name="logs" tab="API 日志">
        <div class="tab-toolbar">
          <NButton size="small" @click="loadLogs">刷新</NButton>
        </div>
        <NDataTable
          :columns="logColumns"
          :data="logs"
          :loading="loadingLogs"
          :pagination="logPagination"
          class="pp-panel"
          :bordered="false"
        >
          <template #empty>
            <PpEmptyState
              compact
              icon="mdi:timeline-text-outline"
              float-a="mdi:api"
              float-b="mdi:timer-outline"
              title="暂无 API 调用日志"
              description="管理端请求 PayPal 相关接口后，方法、路径、状态与耗时会记录在此，便于排查授权与查单问题。"
            >
              <template #actions>
                <NButton type="primary" strong secondary @click="loadLogs">
                  <template #icon><Icon icon="mdi:refresh" width="18" /></template>
                  刷新日志
                </NButton>
              </template>
            </PpEmptyState>
          </template>
        </NDataTable>
      </NTabPane>
    </NTabs>
  </div>
</template>

<style scoped>
.tab-toolbar {
  margin-bottom: 12px;
}
</style>
