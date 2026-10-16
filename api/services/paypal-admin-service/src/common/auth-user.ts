/** 当前请求的操作人。authMode=disabled 表示本地关闭了 JWT。 */
export type AuthUser = {
  userId: string;
  isAdmin: boolean;
  authMode: 'disabled' | 'jwt';
  permissions: string[];
};
