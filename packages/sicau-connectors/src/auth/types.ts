export type AuthErrorCode =
  | "invalid_session"
  | "session_expired"
  | "stale_challenge"
  | "session_busy"
  | "invalid_input"
  | "capacity_exceeded"
  | "disposed"
  | "captcha_failed"
  | "credentials_failed"
  | "unsupported_verification"
  | "upstream_unavailable"
  | "upstream_timeout"
  | "unknown_response"
  | "cancelled";

export class SchoolAuthError extends Error {
  constructor(public readonly code: AuthErrorCode) {
    super(code);
    this.name = "SchoolAuthError";
  }
}

export interface AuthHttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}
export interface AuthHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
}
/** 服务端传输边界。替身不得用于生产，也不得记录请求或原始响应。 */
export type AuthTransport = (
  request: AuthHttpRequest,
) => Promise<AuthHttpResponse>;
export interface AuthOptions {
  sessionTtlMs?: number;
  requestTimeoutMs?: number;
  maxSessions?: number;
  maxResponseBytes?: number;
}
export interface ChallengeOptions {
  ttlMs?: number;
  signal?: AbortSignal;
}
export interface AuthChallenge {
  /** 仅供服务端保存；平台必须自行关联用户及平台会话，不能下发此句柄。 */
  handle: string;
  challengeVersion: string;
  imageDataUrl: string;
  mimeType: "image/png";
  expiresAt: number;
}
export interface AuthSubmission {
  handle: string;
  challengeVersion: string;
  account: string;
  password: string;
  captcha: string;
  signal?: AbortSignal;
}
export interface AuthIdentity {
  source: "sicau-eauth";
  /** 学校可信标识，原样规范化；仅供后端短时使用，不得记日志或下发。 */
  subject: string;
}
