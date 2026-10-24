import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  WechatExchangeResult,
  WechatProvider,
} from "./wechat-provider.js";

// 微信官方兑换端点固定，客户端不能指定外联地址；失败不自动重试已提交的 code。
const CODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";
const UPSTREAM_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;
// 上游明确表示 code 无效/已被使用的错误码；其余一律按上游不可用处理。
const INVALID_CODE_ERRORS = new Set([40029, 40163]);

interface WechatSessionResponse {
  openid?: unknown;
  unionid?: unknown;
  session_key?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
}

@Injectable()
export class RealWechatProvider implements WechatProvider {
  constructor(private readonly config: ConfigService) {}

  async exchange(code: string): Promise<WechatExchangeResult> {
    const appId = this.config.get<string>("WECHAT_APP_ID");
    const appSecret = this.config.get<string>("WECHAT_APP_SECRET");
    if (!appId || !appSecret) return { ok: false, reason: "upstream" };
    const url = new URL(CODE2SESSION_URL);
    url.searchParams.set("appid", appId);
    url.searchParams.set("secret", appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { accept: "application/json" },
        redirect: "error",
      });
    } catch {
      return { ok: false, reason: "upstream" };
    }
    if (!response.ok) return { ok: false, reason: "upstream" };

    let payload: WechatSessionResponse;
    try {
      payload = JSON.parse(
        await readLimited(response),
      ) as WechatSessionResponse;
    } catch {
      return { ok: false, reason: "upstream" };
    }

    const errcode = typeof payload.errcode === "number" ? payload.errcode : 0;
    if (errcode !== 0) {
      return INVALID_CODE_ERRORS.has(errcode)
        ? { ok: false, reason: "invalid_code" }
        : { ok: false, reason: "upstream" };
    }
    const openId = typeof payload.openid === "string" ? payload.openid : "";
    if (!openId) return { ok: false, reason: "upstream" };
    const unionId =
      typeof payload.unionid === "string" ? payload.unionid : null;
    // session_key 不保存、不下发，仅在适配器内丢弃。
    return { ok: true, identity: { openId, unionId } };
  }
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    throw new Error("响应超过大小上限");
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("响应超过大小上限");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
