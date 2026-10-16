import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayPalAccountEntity } from './entities/paypal-account.entity';
import { TransactionCacheEntity } from './entities/transaction-cache.entity';
import { WebhookEventEntity } from './entities/webhook-event.entity';
import { DisputeEntity } from './entities/dispute.entity';
import { DisputeEventEntity } from './entities/dispute-event.entity';
import { TransactionEntity } from './entities/transaction.entity';
import { ApiLogEntity } from './entities/api-log.entity';
import { ProductImageEntity } from './entities/product-image.entity';
import { OauthSessionEntity } from './entities/oauth-session.entity';
import { ApiLogInterceptor } from './common/api-log.interceptor';
import { AccountService } from './account/account.service';
import { AccountController } from './account/account.controller';
import { PaypalClient } from './paypal/paypal.client';
import { CartImagesService } from './cart/cart-images.service';
import { OauthSessionService } from './oauth/oauth-session.service';
import { OauthController } from './oauth/oauth.controller';
import { RecordsService } from './records/records.service';
import { RecordsController } from './records/records.controller';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { OidcSessionController } from './auth/oidc-session.controller';
import { OidcSessionService } from './auth/oidc-session.service';

/** 本库只放 PayPal 管理数据，表结构由实体上的 comment 同步成中文注释。 */
const entities = [
  PayPalAccountEntity,
  TransactionCacheEntity,
  WebhookEventEntity,
  DisputeEntity,
  DisputeEventEntity,
  TransactionEntity,
  ApiLogEntity,
  ProductImageEntity,
  OauthSessionEntity,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: String(config.get('DB_HOST') || '127.0.0.1'),
        port: Number(config.get('DB_PORT') || 5432),
        username: String(config.get('DB_USERNAME') || 'postgres'),
        password: String(config.get('DB_PASSWORD') || ''),
        database: String(config.get('DB_DATABASE') || 'yxshop_paypal'),
        entities,
        synchronize: String(config.get('DB_SYNCHRONIZE') ?? 'true') !== 'false',
      }),
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [AccountController, OauthController, RecordsController, OidcSessionController],
  providers: [
    AccountService,
    OidcSessionService,
    PaypalClient,
    CartImagesService,
    OauthSessionService,
    RecordsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiLogInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
