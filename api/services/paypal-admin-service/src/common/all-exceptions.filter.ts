import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { PayPalError } from './paypal.error';

/** 全局异常出口，保持与前端 paypalFetch 约定的 { error } 结构。 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof PayPalError) {
      res.status(exception.status || 500).json({
        error: exception.message,
        debugId: exception.debugId || '',
        paypal: exception.body || null,
      });
      return;
    }
    if (exception?.name === 'MulterError') {
      const maxMb = Math.round(Number(process.env.EVIDENCE_MAX_FILE_BYTES || 10 * 1024 * 1024) / (1024 * 1024));
      const maxFiles = Number(process.env.EVIDENCE_MAX_FILES || 5);
      const text =
        exception.code === 'LIMIT_FILE_SIZE'
          ? `单个文件不能超过 ${maxMb}MB`
          : exception.code === 'LIMIT_FILE_COUNT' || exception.code === 'LIMIT_UNEXPECTED_FILE'
            ? `最多上传 ${maxFiles} 个文件`
            : '文件上传失败';
      res.status(400).json({ error: text });
      return;
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as any)?.message;
      res.status(exception.getStatus()).json({
        error: Array.isArray(message) ? message.join('; ') : message || exception.message,
      });
      return;
    }
    res.status(exception?.status || 500).json({ error: exception?.message || '请求失败' });
  }
}
