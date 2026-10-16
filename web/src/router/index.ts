import { createRouter, createWebHistory } from 'vue-router';
import { setupAuthGuards } from './guards';

const base = import.meta.env.VITE_BASE_URL || '/';

export const router = createRouter({
  history: createWebHistory(base),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginPage.vue'),
      meta: { public: true }
    },
    {
      path: '/callback',
      name: 'callback',
      component: () => import('@/views/CallbackPage.vue'),
      meta: { public: true }
    },
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardPage.vue'),
          meta: { requiresAuth: true, title: '概览' }
        },
        {
          path: 'accounts',
          name: 'accounts',
          component: () => import('@/views/AccountsPage.vue'),
          meta: { requiresAuth: true, title: '账号管理' }
        },
        {
          path: 'accounts/:payerId',
          name: 'account-detail',
          component: () => import('@/views/AccountDetailPage.vue'),
          meta: { requiresAuth: true, title: '账号详情' }
        },
        {
          path: 'transactions',
          name: 'transactions',
          component: () => import('@/views/TransactionsPage.vue'),
          meta: { requiresAuth: true, title: '账单' }
        },
        {
          path: 'disputes',
          name: 'disputes',
          component: () => import('@/views/DisputesPage.vue'),
          meta: { requiresAuth: true, title: '争议案件' }
        },
        {
          path: 'disputes/:id',
          name: 'dispute-detail',
          component: () => import('@/views/DisputeDetailPage.vue'),
          meta: { requiresAuth: true, title: '案件详情' }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ],
  scrollBehavior() {
    return { top: 0 };
  }
});

setupAuthGuards(router);
