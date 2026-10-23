import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SyncService } from './sync.service';

/**
 * 每 30 秒扫一次到期任务。
 * 交易 / 争议的间隔、开关都在 pp_sync_task，不再用环境变量硬跑。
 */
@Injectable()
export class SyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncScheduler.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly sync: SyncService) {}

  onModuleInit() {
    this.logger.log('同步调度已启动，每 30s 检查到期任务');
    this.timer = setInterval(() => void this.tick(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      await this.sync.runDueTasks();
    } catch (error) {
      this.logger.warn(`调度失败：${error instanceof Error ? error.message : error}`);
    }
  }
}
