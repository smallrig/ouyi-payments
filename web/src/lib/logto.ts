import LogtoClient, { UserScope } from '@logto/browser';

const endpoint = import.meta.env.VITE_LOGTO_ENDPOINT || 'https://auth.ouyify.net';
const resource = import.meta.env.VITE_LOGTO_API_RESOURCE || 'https://api.portal.internal';

export const logtoResource = resource;

export const logto = new LogtoClient({
  endpoint,
  appId: import.meta.env.VITE_LOGTO_APP_ID,
  resources: [resource],
  scopes: [UserScope.Email, UserScope.Profile, 'access'],
});

export function logtoCallbackUrl() {
  const base = import.meta.env.VITE_BASE_URL || '/';
  return new URL('callback', `${location.origin}${base.startsWith('/') ? base : `/${base}`}`).href;
}
