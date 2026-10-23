import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SyncService } from './sync.service';

/** 同步任务配置与执行记录。 */
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('tasks')
  async tasks() {
    return { tasks: await this.sync.listTasks() };
  }

  @Post('tasks')
  create(@Body() body: Record<string, unknown>) {
    return this.sync.createTask(body || {});
  }

  @Patch('tasks/:id')
  patch(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.sync.patchTask(id, body || {});
  }

  @Delete('tasks/:id')
  remove(@Param('id') id: string) {
    return this.sync.deleteTask(id);
  }

  @Post('tasks/:id/run')
  run(@Param('id') id: string) {
    return this.sync.runTask(id, 'manual');
  }

  @Get('logs')
  async logs(
    @Query('taskId') taskId?: string,
    @Query('type') type?: string,
    @Query('limit') limit = '50',
  ) {
    return { logs: await this.sync.listLogs({ taskId, type, limit: Number(limit) }) };
  }
}
