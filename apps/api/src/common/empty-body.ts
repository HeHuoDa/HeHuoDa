import { createApiError } from "./api-error.js";

// 只接受空请求体的动作（创建事务、取消、刷新验证码）共用同一校验，
// 避免各控制器重复实现并保持一致的错误码。
export function assertEmptyBody(body: unknown): void {
  if (
    body !== undefined &&
    (!body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length > 0)
  )
    throw createApiError(400, "BAD_REQUEST", "此操作不接受输入字段");
}
