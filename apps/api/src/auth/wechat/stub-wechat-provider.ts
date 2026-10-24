import type {
  WechatExchangeResult,
  WechatProvider,
} from "./wechat-provider.js";

// 离线测试替身，仅在非生产环境通过 WECHAT_LOGIN_ADAPTER=stub 启用。
// code 约定：
//   stub-identity:<openid>            兑换成功（可选前缀 stub-identity:<openid>:union:<unionid>）
//   stub-invalid                      上游明确拒绝（invalid_code）
//   stub-upstream                     上游不可用/未知结果
export class StubWechatProvider implements WechatProvider {
  async exchange(code: string): Promise<WechatExchangeResult> {
    if (code === "stub-invalid") return { ok: false, reason: "invalid_code" };
    if (code === "stub-upstream") return { ok: false, reason: "upstream" };
    if (!code.startsWith("stub-identity:"))
      return { ok: false, reason: "invalid_code" };
    const rest = code.slice("stub-identity:".length);
    const [openId, unionPart] = rest.split(":union:");
    if (!openId) return { ok: false, reason: "invalid_code" };
    return {
      ok: true,
      identity: { openId, unionId: unionPart || null },
    };
  }
}
