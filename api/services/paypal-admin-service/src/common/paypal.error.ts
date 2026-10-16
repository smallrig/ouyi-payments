/** 业务错误。过滤器把它收成 { error, debugId, paypal }，不走统一 code/data 包装。 */
export class PayPalError extends Error {
  status: number;
  body: unknown;
  debugId: string;

  constructor(
    message: string,
    { status = 502, body = null, debugId = '' }: { status?: number; body?: unknown; debugId?: string } = {},
  ) {
    super(message);
    this.name = 'PayPalError';
    this.status = status;
    this.body = body;
    this.debugId = debugId;
  }
}
