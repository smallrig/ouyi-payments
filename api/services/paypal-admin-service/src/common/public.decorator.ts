import { SetMetadata } from '@nestjs/common';

/** 标记无需登录的路由：健康检查、OAuth 开始与回调、PayPal Webhook。 */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
