import type { Router } from 'vue-router';
import { useAuthStore } from '@/store/auth';

export function setupAuthGuards(router: Router) {
  router.beforeEach(async to => {
    const auth = useAuthStore();
    if (to.meta.public) return true;
    auth.syncTokenFromStorage();
    if (!auth.token) return { name: 'login', query: { redirect: to.fullPath } };
    if (!auth.user) {
      try {
        await auth.fetchProfile();
      } catch {
        auth.token = '';
        auth.user = null;
        auth.persist();
        return { name: 'login', query: { redirect: to.fullPath } };
      }
    }
    if (!auth.user) return { name: 'login', query: { redirect: to.fullPath } };
    return true;
  });
}
