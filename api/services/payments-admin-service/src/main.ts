import 'reflect-metadata';
import './load-env';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

function parseCorsOrigins(raw?: string): string | string[] {
  const list = String(raw || 'http://127.0.0.1:9713')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return list.length <= 1 ? list[0] || 'http://127.0.0.1:9713' : list;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const origin = parseCorsOrigins(config.get<string>('CORS_ORIGIN'));
  const host = config.get<string>('HOST') || '127.0.0.1';
  app.enableCors({
    origin,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-User-Id', 'X-User-Role'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.setGlobalPrefix(config.get<string>('API_PREFIX') || 'api');
  const port = Number(config.get('PORT') || 3025);
  await app.listen(port, host);
  const db = config.get('DB_DATABASE') || 'yxshop_paypal';
  console.log(`PayPal Admin API: http://${host}:${port}`);
  console.log(`Database: ${db}`);
}

bootstrap();
