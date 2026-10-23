<script setup lang="ts">
import { Icon } from '@iconify/vue';

export type HeroMetric = {
  label: string;
  value: string | number;
  hint?: string;
};

withDefaults(
  defineProps<{
    icon?: string;
    kicker?: string;
    title: string;
    description?: string;
    metrics?: HeroMetric[];
  }>(),
  {
    icon: 'mdi:wallet-outline',
    kicker: '',
    description: '',
    metrics: () => []
  }
);
</script>

<template>
  <header class="hero">
    <div class="hero__main">
      <div class="hero__copy">
        <span class="hero__mark" aria-hidden="true">
          <Icon :icon="icon" width="22" />
        </span>
        <div class="hero__text">
          <p v-if="kicker" class="hero__kicker">{{ kicker }}</p>
          <h1 class="hero__title">{{ title }}</h1>
          <p v-if="description" class="hero__desc">{{ description }}</p>
        </div>
      </div>
      <div v-if="$slots.actions" class="hero__actions">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="metrics.length" class="hero__metrics">
      <div v-for="item in metrics" :key="item.label" class="hero__metric">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <em v-if="item.hint">{{ item.hint }}</em>
      </div>
    </div>
  </header>
</template>

<style scoped>
.hero {
  margin-bottom: 16px;
  padding: 20px 22px 18px;
  border-radius: 14px;
  color: #fff;
  background:
    radial-gradient(ellipse 70% 130% at 92% -20%, rgba(90, 180, 255, 0.42), transparent 56%),
    radial-gradient(ellipse 40% 80% at 0% 120%, rgba(0, 32, 96, 0.35), transparent 60%),
    linear-gradient(128deg, #00286f 0%, #003087 28%, #0070ba 72%, #1a8adf 100%);
  box-shadow: 0 10px 28px rgba(0, 48, 135, 0.18);
}

.hero__main {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.hero__copy {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
}

.hero__mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: 13px;
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}

.hero__kicker {
  margin: 0 0 3px;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  opacity: 0.72;
}

.hero__title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.25;
}

.hero__desc {
  margin: 6px 0 0;
  max-width: 52ch;
  font-size: 0.84rem;
  line-height: 1.5;
  opacity: 0.78;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hero__actions :deep(.n-button) {
  --n-text-color: #fff !important;
  --n-text-color-hover: #fff !important;
  --n-border: 1px solid rgba(255, 255, 255, 0.28) !important;
  --n-border-hover: 1px solid rgba(255, 255, 255, 0.5) !important;
  --n-color: rgba(255, 255, 255, 0.12) !important;
  --n-color-hover: rgba(255, 255, 255, 0.2) !important;
}

.hero__actions :deep(.n-button--primary-type) {
  --n-color: #fff !important;
  --n-color-hover: #f3f8ff !important;
  --n-text-color: #003087 !important;
  --n-text-color-hover: #003087 !important;
  --n-border: 1px solid #fff !important;
  --n-border-hover: 1px solid #fff !important;
}

.hero__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.hero__metric {
  min-width: 124px;
  padding: 10px 14px 11px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.hero__metric span {
  display: block;
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  opacity: 0.7;
}

.hero__metric strong {
  display: block;
  margin-top: 4px;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.hero__metric em {
  display: block;
  margin-top: 3px;
  font-size: 0.7rem;
  font-style: normal;
  color: #fecaca;
}
</style>
