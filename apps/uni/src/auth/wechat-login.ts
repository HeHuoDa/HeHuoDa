/**
 * 微信临时 code 获取。
 *
 * 只调用平台登录实现换取一次性 code，交给后端兑换；不请求手机号、
 * 不索取头像昵称，也不把自报 OpenID / 用户 ID 当作身份。
 * 独立成可注入的小模块，便于用平台替身验证取消与失败路径。
 */

export type WechatCodeFailure = "cancelled" | "failed";

export class WechatCodeError extends Error {
  readonly reason: WechatCodeFailure;

  constructor(reason: WechatCodeFailure, message: string) {
    super(message);
    this.name = "WechatCodeError";
    this.reason = reason;
  }
}

export interface WechatLoginOptions {
  provider: "weixin";
  success(result: { code?: string; errMsg?: string }): void;
  fail(error: { errMsg?: string }): void;
}

export function createWechatCodeRequester(
  login: (options: WechatLoginOptions) => void,
) {
  return (): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      try {
        login({
          provider: "weixin",
          success(result) {
            const code =
              typeof result?.code === "string" ? result.code.trim() : "";
            if (!code) {
              reject(
                new WechatCodeError("failed", "未能取得微信登录凭证，请重试。"),
              );
              return;
            }
            resolve(code);
          },
          fail(error) {
            const message = String(error?.errMsg ?? "").toLowerCase();
            reject(
              message.includes("cancel")
                ? new WechatCodeError(
                    "cancelled",
                    "已取消微信登录，可继续浏览公开内容。",
                  )
                : new WechatCodeError("failed", "微信登录未完成，请重试。"),
            );
          },
        });
      } catch {
        reject(
          new WechatCodeError("failed", "当前环境无法唤起微信登录，请重试。"),
        );
      }
    });
}

export const requestWechatCode = createWechatCodeRequester((options) => {
  uni.login(options as unknown as Parameters<typeof uni.login>[0]);
});
