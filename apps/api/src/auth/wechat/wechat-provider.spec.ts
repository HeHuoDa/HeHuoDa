import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { RealWechatProvider } from "./real-wechat-provider.js";
import { StubWechatProvider } from "./stub-wechat-provider.js";

function jsonResponse(body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("StubWechatProvider", () => {
  const provider = new StubWechatProvider();
  it("按 code 约定兑换身份", async () => {
    expect(await provider.exchange("stub-identity:o-1")).toEqual({
      ok: true,
      identity: { openId: "o-1", unionId: null },
    });
    expect(await provider.exchange("stub-identity:o-2:union:u-2")).toEqual({
      ok: true,
      identity: { openId: "o-2", unionId: "u-2" },
    });
  });
  it("显式区分上游拒绝与不可用", async () => {
    expect(await provider.exchange("stub-invalid")).toEqual({
      ok: false,
      reason: "invalid_code",
    });
    expect(await provider.exchange("stub-upstream")).toEqual({
      ok: false,
      reason: "upstream",
    });
    expect(await provider.exchange("random-code")).toEqual({
      ok: false,
      reason: "invalid_code",
    });
  });
});

describe("RealWechatProvider", () => {
  function providerWith(fetchMock: typeof fetch) {
    globalThis.fetch = fetchMock;
    return new RealWechatProvider(
      new ConfigService({
        WECHAT_APP_ID: "wxtestappid1234567",
        WECHAT_APP_SECRET: "test-secret-32-chars-aaaaaaaaaa",
      }),
    );
  }
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("调用固定官方端点且 grant_type 固定", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ openid: "o-1" }));
    const result = await providerWith(fetchMock).exchange("CODE-1");
    expect(result).toEqual({
      ok: true,
      identity: { openId: "o-1", unionId: null },
    });
    const [input] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe(
      "https://api.weixin.qq.com/sns/jscode2session",
    );
    expect(url.searchParams.get("appid")).toBe("wxtestappid1234567");
    expect(url.searchParams.get("js_code")).toBe("CODE-1");
    expect(url.searchParams.get("grant_type")).toBe("authorization_code");
  });

  it.each([40029, 40163])("errcode %s 视为 code 无效", async (errcode) => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ errcode, errmsg: "bad code" }),
    );
    expect(await providerWith(fetchMock).exchange("CODE")).toEqual({
      ok: false,
      reason: "invalid_code",
    });
  });

  it.each([
    ["HTTP 500", async () => new Response("boom", { status: 500 })],
    ["系统繁忙", async () => jsonResponse({ errcode: -1 })],
    ["非 JSON", async () => new Response("not json")],
    ["网络失败", () => Promise.reject(new Error("network down"))],
    ["缺少 openid", async () => jsonResponse({ session_key: "k" })],
  ])("%s 视为上游不可用", async (_, respond) => {
    const fetchMock = jest.fn(respond);
    expect(await providerWith(fetchMock).exchange("CODE")).toEqual({
      ok: false,
      reason: "upstream",
    });
  });

  it("超过大小上限的响应视为上游不可用", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ openid: "o-1" }, { "content-length": "999999" }),
    );
    expect(await providerWith(fetchMock).exchange("CODE")).toEqual({
      ok: false,
      reason: "upstream",
    });
  });

  it("未配置 AppID/Secret 时不外联并视为不可用", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ openid: "o-1" }));
    globalThis.fetch = fetchMock;
    const provider = new RealWechatProvider(new ConfigService({}));
    expect(await provider.exchange("CODE")).toEqual({
      ok: false,
      reason: "upstream",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
