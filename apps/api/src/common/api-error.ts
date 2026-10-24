import { HttpException } from "@nestjs/common";

// 携带业务错误码与公开详情的异常；全局过滤器透传 code/message/details。
export function createApiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException(
    { code, message, ...(details ? { details } : {}) },
    status,
  );
}
