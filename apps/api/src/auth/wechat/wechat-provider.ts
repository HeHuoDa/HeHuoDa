export interface WechatIdentity {
  openId: string;
  unionId: string | null;
}

export type WechatExchangeResult =
  | { ok: true; identity: WechatIdentity }
  // invalid_code：上游明确拒绝该 code（错误、过期、已被使用）；
  // upstream：超时、网络失败、上游错误或返回不可解析，未知结果不得创建会话。
  | { ok: false; reason: "invalid_code" | "upstream" };

export interface WechatProvider {
  exchange(code: string): Promise<WechatExchangeResult>;
}
