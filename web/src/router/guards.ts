import type { Router } from 'vue-router';
import { useAuthStore } from '@/store/auth';

export function setupAuthGuards(router: Router) {
  router.beforeEach(async to => {
    if (to.meta.public) return true;

    const requiresAuth = to.meta.requiresAuth !== false;
    if (!requiresAuth) return true;

    const auth = useAuthStore();
    const ok = await auth.ensureSession();
    if (!ok) return { name: 'login', query: { redirect: to.fullPath } };
    return true;
  });
}
