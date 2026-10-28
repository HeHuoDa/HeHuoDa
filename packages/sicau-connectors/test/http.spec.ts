import { jest } from "@jest/globals";
import { gzipSync } from "node:zlib";
import {
  BoundedFetcher,
  defaultLimits,
  normalizeUrl,
  publicAddress,
  parseRobots,
  robotsAllowed,
  parseDnsOverrides,
  type HttpResponse,
  type Transport,
  sources,
} from "../dist/notices/index.js";

const source = sources[0],
  url = source.listUrl;
const response = (
  status: number,
  html = "正文",
  headers: Record<string, string> = {},
): HttpResponse => ({ status, headers, body: new TextEncoder().encode(html) });
function fetcher(responses: (HttpResponse | Error)[], limits = defaultLimits) {
  let time = 0;
  const sleeps: number[] = [];
  const transport = jest.fn<Transport>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("测试预算外的请求");
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    transport,
    sleeps,
    fetcher: new BoundedFetcher(
      source,
      limits,
      transport,
      () => time,
      async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
    ),
  };
}
describe("有边界的 HTTP 采集", () => {
  it("附件入口逐跳使用独立静态路径范围并保留文件查询标识", async () => {
    const target = `https://${source.host}/system/_content/download.jsp?id=7&owner=1`;
    const { fetcher: client } = fetcher([
      response(404, ""),
      response(200, "%PDF-test"),
    ]);
    await client.checkRobots();
    await expect(client.get(target)).rejects.toThrow("路径");
    expect((await client.getAttachment(target)).url).toBe(target);
    await expect(
      client.getAttachment(`https://${source.host}/admin/export.pdf`),
    ).rejects.toThrow("路径");
  });
  it("字节入口保留非 UTF-8 内容并与 HTML 入口共享 robots 和请求预算", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);
    const { fetcher: client } = fetcher(
      [
        response(404, ""),
        {
          status: 200,
          headers: { "content-type": "application/pdf" },
          body: bytes,
        },
        response(200, "比赛正文"),
      ],
      { ...defaultLimits, requests: 3 },
    );
    await expect(client.getBytes(url)).rejects.toThrow("robots");
    await client.checkRobots();
    expect((await client.getBytes(url)).body).toEqual(bytes);
    expect((await client.get(url)).html).toBe("比赛正文");
    await expect(client.getBytes(url)).rejects.toThrow("请求预算");
  });
  it("实际请求及下载字节累计包含robots、跳转和重试响应", async () => {
    const replies = [
      response(404, "robots"),
      response(302, "redirect", { location: url }),
      response(503, "busy"),
      response(200, "ok"),
    ];
    const { fetcher: client } = fetcher(replies);
    await client.checkRobots();
    await client.get(url);
    expect(client.usage).toMatchObject({ requests: 4, downloadedBytes: 20 });
    expect(client.usage.elapsedMs).toBeGreaterThanOrEqual(8000);
  });
  it("同源未注册路径与逐跳越界也拒绝，不能只检查域名", async () => {
    expect(() =>
      normalizeUrl(`https://${source.host}/admin/export`, source),
    ).toThrow("路径");
    const redirected = fetcher([
      response(404),
      response(302, "", { location: "/admin/export" }),
    ]);
    await redirected.fetcher.checkRobots();
    await expect(redirected.fetcher.get(url)).rejects.toThrow("路径");
    expect(redirected.transport).toHaveBeenCalledTimes(2);
  });
  it("字节入口同样拒绝 robots 禁止路径和越界跳转", async () => {
    const denied = fetcher([response(200, "User-agent: *\nDisallow: /info/")]);
    await denied.fetcher.checkRobots();
    await expect(
      denied.fetcher.getBytes(`https://${source.host}/info/1/2.htm`),
    ).rejects.toThrow("robots");
    const redirected = fetcher([
      response(404, ""),
      response(302, "", { location: "https://127.0.0.1/private" }),
    ]);
    await redirected.fetcher.checkRobots();
    await expect(redirected.fetcher.getBytes(url)).rejects.toThrow("白名单");
  });
  it("字节入口对解压输出限制体积，返回解压后的原始字节", async () => {
    const binary = new Uint8Array([0xff, 0x00, 0x80]);
    const valid = fetcher([
      response(404, ""),
      {
        status: 200,
        headers: { "content-encoding": "gzip" },
        body: gzipSync(binary),
      },
    ]);
    await valid.fetcher.checkRobots();
    expect((await valid.fetcher.getBytes(url)).body).toEqual(binary);
    const huge = fetcher(
      [
        response(404, ""),
        {
          status: 200,
          headers: { "content-encoding": "gzip" },
          body: gzipSync("x".repeat(2048)),
        },
      ],
      { ...defaultLimits, bytes: 1024 },
    );
    await huge.fetcher.checkRobots();
    await expect(huge.fetcher.getBytes(url)).rejects.toThrow("上限");
  });
  it("解压官网 gzip 正文，同时限制解压后的响应大小", async () => {
    const compressed = (html: string): HttpResponse => ({
      status: 200,
      headers: { "content-encoding": "gzip" },
      body: gzipSync(html),
    });
    const valid = fetcher([response(404), compressed("<p>比赛报名通知</p>")]);
    await valid.fetcher.checkRobots();
    const result = await valid.fetcher.get(url);
    expect(result.html).toBe("<p>比赛报名通知</p>");
    expect(result.body).toEqual(gzipSync("<p>比赛报名通知</p>"));
    const oversized = fetcher([response(404), compressed("x".repeat(2000))], {
      ...defaultLimits,
      bytes: 1024,
    });
    await oversized.fetcher.checkRobots();
    await expect(oversized.fetcher.get(url)).rejects.toThrow();
  });
  it("可选 DNS 配置仅限两个来源的公网地址，不允许 fake-IP、内网或任意主机", () => {
    expect(parseDnsOverrides('{"xxgc.sicau.edu.cn":["8.8.8.8"]}')).toEqual({
      "xxgc.sicau.edu.cn": ["8.8.8.8"],
    });
    for (const value of [
      '{"xxgc.sicau.edu.cn":["198.18.1.126"]}',
      '{"xxgc.sicau.edu.cn":["127.0.0.1"]}',
      '{"evil.test":["8.8.8.8"]}',
      "[]",
      "bad",
    ])
      expect(() => parseDnsOverrides(value)).toThrow();
  });
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
  ])("拒绝本机、私网、元数据和特殊地址 %s", (address) =>
    expect(publicAddress(address)).toBe(false),
  );
  it("全球地址可用，URL 保留有意义参数仅清理常见追踪参数", () => {
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(publicAddress("2606:4700:4700::1111")).toBe(true);
    expect(
      normalizeUrl(
        "https://xxgc.sicau.edu.cn/info/1/2.htm?id=7&utm_source=x#top",
        source,
      ),
    ).toBe("https://xxgc.sicau.edu.cn/info/1/2.htm?id=7");
  });
  it("404 robots 可继续，403/不可读规则停止，路径规则与指定 UA 生效", async () => {
    const good = fetcher([response(404), response(200)]);
    await good.fetcher.checkRobots();
    await good.fetcher.get(url);
    expect(good.sleeps).toEqual([2000, 2000]);
    const forbidden = fetcher([response(403)]);
    await expect(forbidden.fetcher.checkRobots()).rejects.toThrow("拒绝");
    const rules = parseRobots(
      "User-agent: *\nDisallow: /\nUser-agent: HeHuoDaIngestion\nDisallow: /info/\nAllow: /info/public/\nCrawl-delay: 3",
    );
    expect(rules.delay).toBe(3000);
    expect(robotsAllowed("/info/private/a", rules.rules)).toBe(false);
    expect(robotsAllowed("/info/public/a", rules.rules)).toBe(true);
    const unrelated = parseRobots(
      "User-agent: *\nDisallow: /\nUser-agent: heh\nAllow: /",
    );
    expect(robotsAllowed("/info/a", unrelated.rules)).toBe(false);
  });
  it("重定向逐跳校验白名单、robots 路径与次数", async () => {
    const dangerous = fetcher([
      response(404),
      response(302, "", { location: "https://127.0.0.1/private" }),
    ]);
    await dangerous.fetcher.checkRobots();
    await expect(dangerous.fetcher.get(url)).rejects.toThrow("白名单");
    expect(dangerous.transport).toHaveBeenCalledTimes(2);
    const loop = fetcher([
      response(404),
      ...Array.from({ length: 4 }, () => response(302, "", { location: url })),
    ]);
    await loop.fetcher.checkRobots();
    await expect(loop.fetcher.get(url)).rejects.toThrow("重定向");
    const robot = fetcher([
      response(200, "User-agent: *\nDisallow: /info/1/2.htm"),
      response(302, "", { location: "/info/1/2.htm" }),
    ]);
    await robot.fetcher.checkRobots();
    await expect(robot.fetcher.get(url)).rejects.toThrow("robots");
  });
  it("429遵循 Retry-After，超时有限重试，永久错误不反复请求", async () => {
    const limited = fetcher([
      response(404),
      response(429, "", { "retry-after": "5" }),
      response(200),
    ]);
    await limited.fetcher.checkRobots();
    await limited.fetcher.get(url);
    expect(limited.sleeps).toContain(5000);
    const timeout = fetcher([
      response(404),
      new Error("timeout"),
      new Error("timeout"),
      new Error("timeout"),
    ]);
    await timeout.fetcher.checkRobots();
    await expect(timeout.fetcher.get(url)).rejects.toThrow("有限重试");
    expect(timeout.transport).toHaveBeenCalledTimes(4);
    const permanent = fetcher([response(404), response(404)]);
    await permanent.fetcher.checkRobots();
    expect((await permanent.fetcher.get(url)).status).toBe(404);
    expect(permanent.transport).toHaveBeenCalledTimes(2);
  });
  it("请求数、响应体与运行时长预算有界，验证码停止", async () => {
    const budget = fetcher([response(404)], { ...defaultLimits, requests: 1 });
    await budget.fetcher.checkRobots();
    await expect(budget.fetcher.get(url)).rejects.toThrow("请求预算");
    const huge = fetcher([response(404), response(200, "x".repeat(1100))], {
      ...defaultLimits,
      bytes: 1024,
    });
    await huge.fetcher.checkRobots();
    await expect(huge.fetcher.get(url)).rejects.toThrow("上限");
    const time = fetcher([response(404)], {
      ...defaultLimits,
      durationMs: 3000,
    });
    await time.fetcher.checkRobots();
    await expect(time.fetcher.get(url)).rejects.toThrow("时长预算");
    const captcha = fetcher([response(404), response(200, "请输入验证码")]);
    await captcha.fetcher.checkRobots();
    await expect(captcha.fetcher.get(url)).rejects.toThrow("验证码");
  });
  it("实际传输在 DNS 地址校验后才连接，危险地址不会发出请求", async () => {
    const local = new BoundedFetcher(
      { ...source, host: "127.0.0.1" },
      { ...defaultLimits, timeoutMs: 1000 },
    );
    await expect(local.checkRobots()).rejects.toThrow("危险连接地址");
  });
});
