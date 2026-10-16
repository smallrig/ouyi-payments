<script setup lang="ts">
import { dateZhCN, NConfigProvider, NDialogProvider, NMessageProvider, zhCN } from 'naive-ui';

const themeOverrides = {
  common: {
    primaryColor: '#0070BA',
    primaryColorHover: '#005EA6',
    primaryColorPressed: '#003087',
    primaryColorSuppl: '#0070BA',
    borderRadius: '6px',
    fontFamily: "'Plus Jakarta Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    textColorBase: '#1A2332',
    bodyColor: '#F0F3F8'
  },
  Button: {
    fontWeight: '600',
    borderRadiusMedium: '6px',
    borderRadiusLarge: '8px',
    heightMedium: '34px',
    heightLarge: '40px'
  },
  Card: {
    borderRadius: '10px',
    paddingMedium: '18px'
  },
  DataTable: {
    borderRadius: '10px',
    thColor: '#F7F9FC',
    thTextColor: '#6B7A90',
    thFontWeight: '650'
  },
  Input: {
    borderRadius: '6px',
    heightMedium: '34px'
  },
  Select: {
    peers: {
      InternalSelection: {
        heightMedium: '34px',
        borderRadius: '6px'
      }
    }
  },
  Tag: {
    borderRadius: '4px'
  }
};
</script>

<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides" class="app-root">
    <NMessageProvider>
      <NDialogProvider>
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
.app-root {
  min-height: 100%;
  height: 100%;
}
</style>
