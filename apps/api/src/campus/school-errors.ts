import { HttpException } from "@nestjs/common";
import {
  SchoolAuthError,
  type AuthErrorCode,
} from "@hehuoda/sicau-connectors/auth";
import { createApiError } from "../common/api-error.js";

// 校方错误码到平台 HTTP 状态的唯一映射；匿名登录与已登录核验共用。
export const schoolErrorStatus: Record<AuthErrorCode, number> = {
  invalid_session: 409,
  session_expired: 409,
  stale_challenge: 409,
  session_busy: 409,
  invalid_input: 400,
  capacity_exceeded: 503,
  disposed: 503,
  captcha_failed: 400,
  credentials_failed: 400,
  unsupported_verification: 400,
  upstream_unavailable: 503,
  upstream_timeout: 503,
  unknown_response: 503,
  cancelled: 409,
};

// 落库与审计的失败原因只能是安全枚举，绝不携带学校原值、密码或验证码。
export function safeSchoolReason(error: unknown): string {
  if (error instanceof SchoolAuthError) return error.code;
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      typeof response === "object" &&
      "code" in response &&
      response.code === "CAMPUS_IDENTITY_MISMATCH"
    )
      return "identity_mismatch";
  }
  return "internal_failure";
}

// 对外错误只暴露安全枚举；平台自有 HttpException 原样透传。
export function schoolApiError(error: unknown): HttpException {
  if (error instanceof SchoolAuthError)
    return createApiError(
      schoolErrorStatus[error.code],
      `CAMPUS_${error.code.toUpperCase()}`,
      "统一身份认证未完成，请根据状态重新发起",
    );
  if (error instanceof HttpException) return error;
  return createApiError(
    503,
    "CAMPUS_VERIFICATION_FAILED",
    "统一身份认证暂不可用",
  );
}
