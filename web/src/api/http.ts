import { useAuthStore } from '@/store/auth';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * 浏览器请求前缀。
 * 生产推荐留空 VITE_PAYPAL_API_BASE，走同源 /api（由 Nginx 反代到 payments-api），避免跨域与旧缓存误打静态站 405。
 * 开发可设 VITE_PAYPAL_API_BASE，或走 Vite 代理 /api/paypal。
 */
function paypalApiPrefix(): string {
  const direct = (import.meta.env.VITE_PAYPAL_API_BASE || '').replace(/\/$/, '');
  if (direct) return `${direct}/api`;
  if (import.meta.env.DEV) return '/api/paypal';
  return '/api';
}

export function paypalApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${paypalApiPrefix()}${p}`;
}

type RequestOptions = RequestInit & { skipAuth?: boolean };

export async function paypalFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuth, headers: initHeaders, ...rest } = options;
  const headers = new Headers(initHeaders);
  if (!headers.has('Content-Type') && rest.body && typeof rest.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (!skipAuth) {
    const auth = useAuthStore();
    if (auth.token) headers.set('Authorization', `Bearer ${auth.token}`);
  }

  const res = await fetch(paypalApiUrl(path), {
    ...rest,
    headers,
    credentials: 'include'
  });

  let data: unknown = null;
  const text = await res.text();
  const looksLikeHtml = /^\s*<!doctype html|^\s*<html/i.test(text || '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok || looksLikeHtml) {
    let msg = res.statusText || '请求失败';
    if (looksLikeHtml) {
      msg =
        'PayPal API 未正确代理（收到 HTML）。请确认 VITE_PAYPAL_API_TARGET，或使用带 /api/paypal 代理的 dev/preview。';
    } else if (data && typeof data === 'object' && 'error' in data) {
      msg = String((data as { error: unknown }).error);
    }
    throw new ApiError(msg, looksLikeHtml ? 502 : res.status, data);
  }

  return data as T;
}
