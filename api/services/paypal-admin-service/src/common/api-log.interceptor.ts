import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { finalize } from 'rxjs';
import { RecordsService } from '../records/records.service';

/** 把每次接口调用写入 pp_api_log，不再追加 data/logs.json。 */
@Injectable()
export class ApiLogInterceptor implements NestInterceptor {
  constructor(private readonly records: RecordsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const started = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const path = String(req.originalUrl || req.url || '');
    if (path.startsWith('/api/health')) return next.handle();
    return next.handle().pipe(
      finalize(() => {
        const payer = /\/accounts\/([^/?]+)/.exec(path);
        void this.records
          .appendLog({
            method: req.method,
            path: path.split('?')[0],
            status: Number(res.statusCode) || 0,
            userId: req.user?.userId || '',
            payerId: payer ? decodeURIComponent(payer[1]) : '',
            ms: Date.now() - started,
          })
          .catch(() => undefined);
      }),
    );
  }
}
