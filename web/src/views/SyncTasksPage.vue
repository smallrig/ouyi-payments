<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { NButton, NModal, NPagination, NSelect, NSwitch, useMessage } from 'naive-ui';
import PpAsyncPane from '@/components/PpAsyncPane.vue';
import PpEmptyState from '@/components/PpEmptyState.vue';
import PpPageHero from '@/components/PpPageHero.vue';
import { useClientPagination } from '@/composables/useClientPagination';
import {
  createSyncTask,
  deleteSyncTask,
  fetchAccounts,
  fetchSyncLogs,
  fetchSyncTasks,
  patchSyncTask,
  runSyncTask
} from '@/api/paypal';
import type { PayPalAccount, SyncLog, SyncTask } from '@/api/types';
import { formatDateTime, formatShortDateTime } from '@/lib/format';

const route = useRoute();
const router = useRouter();
const message = useMessage();

type Tab = 'tasks' | 'logs';
const activeTab = ref<Tab>(route.query.tab === 'logs' ? 'logs' : 'tasks');
const loading = ref(true);
const runningId = ref('');
const saving = ref(false);
const tasks = ref<SyncTask[]>([]);
const logs = ref<SyncLog[]>([]);
const accounts = ref<PayPalAccount[]>([]);
const logType = ref<string | null>(null);
const logTaskId = ref<string | null>(null);
const editorOpen = ref(false);
const editing = ref<SyncTask | null>(null);
const form = ref({
  name: '',
  type: 'transactions',
  payerId: '',
  intervalSec: 900,
  lookbackDays: 31,
  enabled: true
});

const intervalOptions = [
  { label: '每 5 分钟', value: 300 },
  { label: '每 15 分钟', value: 900 },
  { label: '每 30 分钟', value: 1800 },
  { label: '每 1 小时', value: 3600 },
  { label: '每 6 小时', value: 21600 },
  { label: '每天', value: 86400 }
];

const typeOptions = [
  { label: '交易流水', value: 'transactions' },
  { label: '争议案件', value: 'disputes' }
];

const dayOptions = [
  { label: '近 7 天', value: 7 },
  { label: '近 14 天', value: 14 },
  { label: '近 31 天', value: 31 }
];

const accountOptions = computed(() => [
  { label: '全部已授权账号', value: '' },
  ...accounts.value.map(acc => ({
    label: acc.email || acc.name || acc.payerId,
    value: acc.payerId
  }))
]);

const taskOptions = computed(() => tasks.value.map(task => ({ label: task.name, value: task.id })));

const enabledCount = computed(() => tasks.value.filter(task => task.enabled).length);
const failedCount = computed(() => tasks.value.filter(task => task.status === 'failed').length);
const lastRunText = computed(() => {
  const latest = tasks.value
    .map(task => task.lastRunAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  return latest ? formatShortDateTime(latest) : '尚未执行';
});
const todayLogCount = computed(() => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return logs.value.filter(row => {
    const at = new Date(row.startedAt).getTime();
    return Number.isFinite(at) && at >= start.getTime();
  }).length;
});

const heroMetrics = computed(() => [
  { label: '任务总数', value: tasks.value.length },
  { label: '已启用', value: enabledCount.value },
  { label: '最近执行', value: lastRunText.value },
  {
    label: '今日记录',
    value: todayLogCount.value,
    hint: failedCount.value ? `${failedCount.value} 条上次失败` : undefined
  }
]);

const filteredLogs = computed(() => {
  return logs.value.filter(row => {
    if (logType.value && row.type !== logType.value) return false;
    if (logTaskId.value && row.taskId !== logTaskId.value) return false;
    return true;
  });
});

const {
  page: taskPage,
  pageSize: taskPageSize,
  pageSizes,
  paged: pagedTasks,
  resetPage: resetTaskPage
} = useClientPagination(tasks, 10);
const {
  page: logPage,
  pageSize: logPageSize,
  paged: pagedLogs,
  resetPage: resetLogPage
} = useClientPagination(filteredLogs, 10);

function typeLabel(type: string) {
  return type === 'disputes' ? '争议案件' : '交易流水';
}

function intervalLabel(sec: number) {
  return intervalOptions.find(item => item.value === sec)?.label || `每 ${sec} 秒`;
}

function statusTone(status: string) {
  if (status === 'success') return 'ok';
  if (status === 'failed') return 'bad';
  if (status === 'running') return 'warn';
  return 'mute';
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    idle: '未执行',
    running: '执行中',
    success: '成功',
    failed: '失败',
    skipped: '跳过'
  };
  return map[status] || status || '—';
}

function triggerLabel(value: string) {
  return value === 'manual' ? '手动' : '定时';
}

function setTab(tab: Tab) {
  activeTab.value = tab;
  void router.replace({ name: 'sync-tasks', query: { tab } });
}

function openCreate() {
  editing.value = null;
  form.value = {
    name: '',
    type: 'transactions',
    payerId: '',
    intervalSec: 900,
    lookbackDays: 31,
    enabled: true
  };
  editorOpen.value = true;
}

function openEdit(row: SyncTask) {
  editing.value = row;
  form.value = {
    name: row.name,
    type: row.type,
    payerId: row.payerId,
    intervalSec: row.intervalSec,
    lookbackDays: row.lookbackDays || 31,
    enabled: row.enabled
  };
  editorOpen.value = true;
}

async function saveTask() {
  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      type: form.value.type,
      payerId: form.value.payerId,
      intervalSec: form.value.intervalSec,
      lookbackDays: form.value.lookbackDays,
      enabled: form.value.enabled
    };
    if (editing.value) {
      await patchSyncTask(editing.value.id, payload);
      message.success('已更新任务');
    } else {
      await createSyncTask(payload);
      message.success('已创建任务');
    }
    editorOpen.value = false;
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(row: SyncTask, enabled: boolean) {
  try {
    await patchSyncTask(row.id, { enabled });
    row.enabled = enabled;
    message.success(enabled ? '已启用，约 10 秒后执行' : '已停用');
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '更新失败');
  }
}

async function runNow(row: SyncTask) {
  runningId.value = row.id;
  try {
    const res = await runSyncTask(row.id);
    message.success(res.message || '已执行');
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '执行失败');
  } finally {
    runningId.value = '';
  }
}

async function removeTask(row: SyncTask) {
  if (!window.confirm(`确定删除任务「${row.name}」？`)) return;
  try {
    await deleteSyncTask(row.id);
    message.success('已删除');
    await load();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '删除失败');
  }
}

async function load() {
  loading.value = true;
  try {
    const [taskRows, logRows, accRows] = await Promise.all([
      fetchSyncTasks(),
      fetchSyncLogs({ limit: 200 }),
      fetchAccounts().catch(() => [])
    ]);
    tasks.value = taskRows;
    logs.value = logRows;
    accounts.value = accRows;
    resetTaskPage();
    resetLogPage();
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

watch([logType, logTaskId], () => resetLogPage());

onMounted(() => {
  if (!route.query.tab) {
    void router.replace({ name: 'sync-tasks', query: { tab: activeTab.value } });
  }
  void load();
});
</script>

<template>
  <div class="pp-page">
    <PpPageHero
      icon="mdi:cloud-sync-outline"
      kicker="自动化拉取"
      title="同步任务"
      description="按间隔拉取交易流水与争议案件，并留下每次执行结果。"
      :metrics="heroMetrics"
    >
      <template #actions>
        <NButton :loading="loading" @click="load">
          <template #icon><Icon icon="mdi:refresh" width="16" /></template>
          刷新
        </NButton>
        <NButton type="primary" @click="openCreate">
          <template #icon><Icon icon="mdi:plus" width="16" /></template>
          新建任务
        </NButton>
      </template>
    </PpPageHero>

    <div class="pp-switch" role="tablist" aria-label="同步视图">
      <button
        type="button"
        class="pp-switch__item"
        :class="{ 'is-active': activeTab === 'tasks' }"
        @click="setTab('tasks')"
      >
        <Icon icon="mdi:calendar-clock" width="16" />
        任务配置
        <span class="pp-switch__count">{{ tasks.length }}</span>
      </button>
      <button
        type="button"
        class="pp-switch__item"
        :class="{ 'is-active': activeTab === 'logs' }"
        @click="setTab('logs')"
      >
        <Icon icon="mdi:clipboard-text-clock-outline" width="16" />
        同步记录
        <span class="pp-switch__count">{{ logs.length }}</span>
      </button>
    </div>

    <PpAsyncPane :loading="loading" icon="mdi:cloud-sync-outline" title="加载同步任务" description="正在读取任务与记录…">
      <template v-if="activeTab === 'tasks'">
        <PpEmptyState
          v-if="!tasks.length"
          icon="mdi:calendar-clock"
          title="还没有同步任务"
          description="创建后将按间隔自动拉取交易或争议。首次启动会写入两条默认任务。"
        >
          <template #actions>
            <NButton type="primary" @click="openCreate">新建任务</NButton>
          </template>
        </PpEmptyState>

        <div v-else class="pp-table-wrap">
          <div class="table-scroll">
            <table class="pp-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>类型</th>
                  <th>范围</th>
                  <th>间隔</th>
                  <th>状态</th>
                  <th>上次执行</th>
                  <th>下次执行</th>
                  <th>启用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in pagedTasks" :key="row.id">
                  <td>
                    <strong>{{ row.name }}</strong>
                    <div v-if="row.lastMessage" class="sub">{{ row.lastMessage }}</div>
                  </td>
                  <td class="nowrap">{{ typeLabel(row.type) }}</td>
                  <td>{{ row.payerId ? row.accountLabel || row.payerId : '全部已授权账号' }}</td>
                  <td class="nowrap">
                    {{ intervalLabel(row.intervalSec) }}
                    <template v-if="row.type === 'transactions'"> · {{ row.lookbackDays }} 天</template>
                  </td>
                  <td class="nowrap">
                    <span class="pp-badge" :class="`pp-badge--${statusTone(row.status)}`">
                      {{ statusLabel(row.status) }}
                    </span>
                  </td>
                  <td class="nowrap">{{ formatDateTime(row.lastRunAt) }}</td>
                  <td class="nowrap">{{ row.enabled ? formatDateTime(row.nextRunAt) : '—' }}</td>
                  <td>
                    <NSwitch :value="row.enabled" @update:value="v => toggleEnabled(row, v)" />
                  </td>
                  <td class="nowrap">
                    <div class="pp-ops">
                      <button
                        type="button"
                        class="pp-op is-primary"
                        :class="{ 'is-busy': runningId === row.id }"
                        :disabled="runningId === row.id"
                        @click="runNow(row)"
                      >
                        <Icon
                          :icon="runningId === row.id ? 'mdi:loading' : 'mdi:play-circle-outline'"
                          width="15"
                          :class="{ spin: runningId === row.id }"
                        />
                        {{ runningId === row.id ? '执行中' : '立即执行' }}
                      </button>
                      <button type="button" class="pp-op" @click="openEdit(row)">
                        <Icon icon="mdi:pencil-outline" width="15" />
                        编辑
                      </button>
                      <button type="button" class="pp-op is-danger" @click="removeTask(row)">
                        <Icon icon="mdi:trash-can-outline" width="15" />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pp-pager">
            <div class="pp-pager__meta">共 {{ tasks.length }} 条</div>
            <NPagination
              v-model:page="taskPage"
              v-model:page-size="taskPageSize"
              :item-count="tasks.length"
              :page-sizes="pageSizes"
              show-size-picker
              size="small"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="pp-filter">
          <div class="pp-filter__field">
            <NSelect v-model:value="logType" :options="typeOptions" placeholder="类型" clearable />
          </div>
          <div class="pp-filter__field pp-filter__field--account">
            <NSelect v-model:value="logTaskId" :options="taskOptions" placeholder="任务" clearable />
          </div>
          <div class="pp-filter__actions">
            <NButton quaternary @click="logType = null; logTaskId = null">重置</NButton>
          </div>
        </div>

        <PpEmptyState
          v-if="!filteredLogs.length"
          icon="mdi:clipboard-text-clock-outline"
          title="暂无同步记录"
          description="任务执行后会在这里留下时间和条数。"
        />

        <div v-else class="pp-table-wrap">
          <div class="table-scroll">
            <table class="pp-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>商家</th>
                  <th>触发</th>
                  <th>结果</th>
                  <th>条数</th>
                  <th>耗时</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in pagedLogs" :key="row.id">
                  <td class="nowrap">{{ formatDateTime(row.startedAt) }}</td>
                  <td class="nowrap">{{ typeLabel(row.type) }}</td>
                  <td class="mono nowrap">{{ row.payerId || '汇总' }}</td>
                  <td class="nowrap">{{ triggerLabel(row.triggerBy) }}</td>
                  <td class="nowrap">
                    <span class="pp-badge" :class="`pp-badge--${statusTone(row.status)}`">
                      {{ statusLabel(row.status) }}
                    </span>
                  </td>
                  <td>{{ row.count }}</td>
                  <td class="nowrap">{{ row.ms ? `${row.ms} ms` : '—' }}</td>
                  <td>{{ row.message || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="pp-pager">
            <div class="pp-pager__meta">共 {{ filteredLogs.length }} 条</div>
            <NPagination
              v-model:page="logPage"
              v-model:page-size="logPageSize"
              :item-count="filteredLogs.length"
              :page-sizes="pageSizes"
              show-size-picker
              size="small"
            />
          </div>
        </div>
      </template>
    </PpAsyncPane>

    <NModal
      :show="editorOpen"
      preset="card"
      :title="editing ? '编辑同步任务' : '新建同步任务'"
      style="width: 520px"
      @update:show="open => { if (!open) editorOpen = false }"
    >
      <label class="field">
        <span>名称</span>
        <input v-model="form.name" type="text" placeholder="例如：全量交易流水" />
      </label>
      <label class="field">
        <span>类型</span>
        <NSelect v-model:value="form.type" :options="typeOptions" />
      </label>
      <label class="field">
        <span>同步范围</span>
        <NSelect v-model:value="form.payerId" :options="accountOptions" />
      </label>
      <label class="field">
        <span>执行间隔</span>
        <NSelect v-model:value="form.intervalSec" :options="intervalOptions" />
      </label>
      <label v-if="form.type === 'transactions'" class="field">
        <span>回溯天数</span>
        <NSelect v-model:value="form.lookbackDays" :options="dayOptions" />
      </label>
      <label class="field field--row">
        <span>启用</span>
        <NSwitch v-model:value="form.enabled" />
      </label>
      <div class="dlg__foot">
        <NButton @click="editorOpen = false">取消</NButton>
        <NButton type="primary" :loading="saving" @click="saveTask">保存</NButton>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.table-scroll {
  overflow-x: auto;
}

.table-scroll .pp-table {
  min-width: 1180px;
}

.nowrap {
  white-space: nowrap;
}

.sub {
  margin-top: 4px;
  color: var(--pp-muted);
  font-size: 0.75rem;
  line-height: 1.4;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 0.75rem;
  font-weight: 650;
  color: var(--pp-muted);
}

.field input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--pp-border);
  border-radius: 8px;
  font: inherit;
  color: var(--pp-text);
}

.field--row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.dlg__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
