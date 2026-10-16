import { Body, Controller, Get, Param, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import { envNumber } from '../load-env';
import { Public } from '../common/public.decorator';
import { PaypalClient } from '../paypal/paypal.client';
import { RecordsService } from './records.service';

const evidenceMaxFiles = envNumber('EVIDENCE_MAX_FILES', 5);
const evidenceMaxFileBytes = envNumber('EVIDENCE_MAX_FILE_BYTES', 10 * 1024 * 1024);

/** 健康检查、首页统计、争议案件和 Webhook / 日志查询。 */
@Controller()
export class RecordsController {
  constructor(
    private readonly records: RecordsService,
    private readonly paypal: PaypalClient,
  ) {}

  @Public()
  @Get('health')
  health() {
    const config = this.paypal.config();
    return {
      ok: true,
      service: 'paypal-admin-service',
      env: config.envName,
      port: config.port,
      database: config.database,
    };
  }

  @Get('stats')
  stats() {
    return this.records.stats();
  }

  @Get('disputes')
  async disputes() {
    return { disputes: await this.records.listDisputes() };
  }

  @Post('disputes/sync')
  syncDisputes() {
    return this.records.syncDisputes();
  }

  /** 用本地交易生成示例争议。与 PayPal 同步分开，避免没权限时页面一直是空的。 */
  @Post('disputes/samples')
  seedSamples() {
    return this.records.seedSamples();
  }

  @Get('disputes/:id')
  dispute(@Param('id') id: string) {
    return this.records.showDispute(id);
  }

  /** 提交证据。可只传说明和物流单号，也可附带 JPG、PNG、GIF、PDF。 */
  @Post('disputes/:id/provide-evidence')
  @UseInterceptors(
    FilesInterceptor('files', evidenceMaxFiles, {
      limits: { fileSize: evidenceMaxFileBytes, files: evidenceMaxFiles },
    }),
  )
  provideEvidence(
    @Param('id') id: string,
    @UploadedFiles() files: Array<{ buffer: Buffer; originalname: string; mimetype: string; size: number }>,
    @Body() body: { notes?: string; trackingNumber?: string; carrierName?: string },
  ) {
    return this.records.provideEvidence(id, body || {}, files || []);
  }

  /**
   * action 取 provide-evidence、send-message、make-offer、accept-claim、escalate、appeal。
   * 必须写在 disputes/sync 之后，避免静态路径被 :id 吃掉。
   */
  @Post('disputes/:id/:action')
  disputeAction(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.records.act(id, action, body || {});
  }

  @Public()
  @Post('webhooks/paypal')
  async webhook(@Req() req: any, @Body() body: any) {
    await this.records.appendWebhook({
      id: randomBytes(8).toString('hex'),
      headers: {
        'paypal-transmission-id': req.headers['paypal-transmission-id'] || '',
        'paypal-transmission-time': req.headers['paypal-transmission-time'] || '',
      },
      event: body || {},
    });
    return { ok: true };
  }

  @Get('webhooks')
  async webhooks(@Query('limit') limit = '50') {
    const n = Math.min(100, Number(limit) || 50);
    return { webhooks: await this.records.listWebhooks(n) };
  }

  @Get('logs')
  async logs(@Query('limit') limit = '100') {
    const n = Math.min(200, Number(limit) || 100);
    return { logs: await this.records.listLogs(n) };
  }
}
