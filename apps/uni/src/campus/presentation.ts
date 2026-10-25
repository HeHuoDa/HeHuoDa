import { RequestError } from "../api/http.ts";

export function campusFailure(error: unknown): string {
  if (!(error instanceof RequestError)) return "操作未完成，请稍后重试。";
  if (error.statusCode === 401) return "平台登录已过期，请重新微信登录。";
  if (error.statusCode === 403) return "平台账号当前受限，暂不能核验。";
  if (error.statusCode === 404) return "原核验事务已失效，请重新开始。";
  if (error.statusCode === 429) return "尝试过于频繁，请稍后再试。";
  const code = (error.code ?? "").replace(/^CAMPUS_/, "").toLowerCase();
  const messages: Record<string, string> = {
    binding_conflict:
      "校园账号绑定存在冲突。账号申诉入口尚未开放，请勿反复尝试。",
    consent_mismatch: "核验告知已更新，请重新阅读并同意。",
    verification_unavailable: "校园核验暂未开放或没有当期配置，可继续浏览。",
    profile_unavailable: "学校资料暂时无法读取，请稍后重试。",
    credentials_failed: "学校未接受本次账号凭据，请核对后重新开始。",
    captcha_failed: "验证码未通过，请重新开始并输入新图片中的字符。",
    stale_challenge: "验证码版本已变化，请重新开始。",
    unsupported_verification: "学校要求额外验证，目前暂不支持，请稍后再试。",
    unsupported_identity: "学校返回的身份无法安全识别，暂不能核验。",
    unknown_response: "学校返回的身份信息无法安全确认，暂不能核验。",
    upstream_unavailable: "学校认证服务暂时不可用，请稍后再试。",
    upstream_timeout: "学校响应超时，请查询本次结果。",
    transaction_active: "已有核验正在进行，请稍后再试；旧事务会按期限结束。",
    transaction_busy: "核验正在处理，请查询本次结果。",
    transaction_ended: "本次核验已结束，请重新开始。",
  };
  if (messages[code]) return messages[code];
  if (error.kind === "timeout" || error.kind === "network")
    return "连接中断，结果尚未确认，请查询本次结果。";
  return "服务暂时无法完成核验，请稍后重试。";
}

/** 手工固定 UTC+8，避免设备时区及小程序 Intl 支持差异。 */
export function beijingTime(raw: string | null | undefined): string {
  if (!raw || !Number.isFinite(Date.parse(raw))) return "—";
  const d = new Date(Date.parse(raw) + 8 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}（北京时间）`;
}
export function renewalDue(
  until: string | null | undefined,
  now = Date.now(),
): boolean {
  const remaining = until ? Date.parse(until) - now : NaN;
  return remaining > 0 && remaining <= 7 * 24 * 60 * 60 * 1000;
}
