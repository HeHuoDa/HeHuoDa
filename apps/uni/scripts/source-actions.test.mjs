import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSourceUrl } from "../src/source/policy.ts";
import { resolvePublicSourceUrl } from "../src/source/public-url.ts";
import { createSourceActions } from "../src/source/actions.ts";

test("来源仅接受明确的 HTTP(S) 地址，不修复危险或歧义输入", () => {
  assert.equal(
    parseSourceUrl("https://news.example.edu.cn/info/2026.htm")?.hostname,
    "news.example.edu.cn",
  );
  assert.equal(
    parseSourceUrl("http://news.example.edu.cn:8080/a?q=中文")?.url,
    "http://news.example.edu.cn:8080/a?q=中文",
  );
  for (const url of [
    undefined,
    {},
    "",
    "/news",
    "//example.edu.cn/a",
    "javascript:alert(1)",
    "data:text/html,a",
    "file:///a",
    "https://user:pass@example.edu.cn/a",
    "https://example.edu.cn@evil.test/a",
    "https://example.edu.cn\\@evil.test/a",
    "https://example.edu.cn%2eevil.test/a",
    "https://example.edu.cn:99999/a",
    "https://-bad.test/a",
    "https://example.edu.cn/\nnews",
    " https://example.edu.cn/a",
    "https://example.edu.cn/%zz",
  ]) {
    assert.equal(parseSourceUrl(url), null, String(url));
  }
});

test("复制仅回调成功才报成功；隐私拒绝、不支持、同步异常均保留原始地址", async () => {
  const url = "https://news.example.edu.cn/a?title=中文";
  let copied;
  const actions = createSourceActions({
    writeClipboard: async (value) => {
      copied = value;
    },
  });
  assert.equal((await actions.copy(url)).status, "copied");
  assert.equal(copied, url);
  for (const writeClipboard of [
    undefined,
    () => {
      throw new Error("privacy denied");
    },
    async () => {
      throw new Error("NotAllowedError");
    },
  ]) {
    const result = await createSourceActions({ writeClipboard }).copy(url);
    assert.equal(result.status, "manual");
    assert.equal(result.url, url);
    assert.match(result.message, /手动|长按/);
  }
  copied = undefined;
  assert.equal((await actions.copy("javascript:alert(1)")).status, "invalid");
  assert.equal(copied, undefined);
});

test("来源动作只公开复制，内嵌承载能力已随小程序退役", async () => {
  const actions = createSourceActions({ writeClipboard: async () => {} });
  assert.deepEqual(Object.keys(actions), ["copy"]);
  assert.equal(actions.openWebView, undefined);
  assert.equal(actions.openWeixin, undefined);
});

test("H5 公开外链与管理端手工通道判定一致，管理端能保存的外链在 H5 一定可打开", () => {
  for (const url of [
    "https://news.example.edu.cn/info/2026.htm",
    "https://www.sicau.edu.cn/a?q=1",
    "https://events.other-university.org/race#detail",
    "https://news.example.edu.cn:443/a",
    // 管理端按 URL 归一化判定，这些写法在两端同样接受。
    "https://www.sicau.edu.cn:00443/notice",
    "https://中文.中国/notice",
    "https://www.moe.gov.cn/notice/@2026/index.html",
    "https://www.moe.gov.cn/a?mail=a@b.cn",
    "HTTPS://Example.ORG/path",
  ]) {
    const source = resolvePublicSourceUrl(url);
    assert.ok(source, url);
    assert.equal(source.url, url);
  }
  for (const url of [
    "http://news.example.edu.cn/a",
    "https://news.example.edu.cn:8443/a",
    "https://user:pass@news.example.edu.cn/a",
    "https://user@news.example.edu.cn/a",
    "https://192.168.0.10/a",
    "https://10.0.0.1:443/a",
    "https://[::1]/a",
    "https://localhost/a",
    "https://intranet/a",
    "https://printer.local/a",
    "https://example.test/a",
    "https://example.invalid/a",
    // ADR 0011 与管理端通道一并拒绝的保留后缀。
    "https://x.onion/a",
    "https://printer.corp/a",
    "https://foo.localdomain/a",
    "https://news.example.edu.cn/a b",
    "javascript:alert(1)",
    undefined,
  ])
    assert.equal(resolvePublicSourceUrl(url), null, String(url));
});

test("H5 复制只在地址合法时生效，拒绝地址既不写入也不提供动作", async () => {
  const copied = [];
  const h5 = createSourceActions(
    { writeClipboard: async (url) => copied.push(url) },
    resolvePublicSourceUrl,
  );
  assert.equal(
    (await h5.copy("https://events.other-university.org/race")).status,
    "copied",
  );
  assert.deepEqual(copied, ["https://events.other-university.org/race"]);
  for (const url of ["http://news.example.edu.cn/a", "https://a.test/b"])
    assert.equal((await h5.copy(url)).status, "invalid", url);
  assert.deepEqual(copied, ["https://events.other-university.org/race"]);
});

test("Android 逻辑层没有全局 URL 时仍接受公开 HTTPS 官方来源", () => {
  const originalUrl = globalThis.URL;
  try {
    globalThis.URL = undefined;
    const officialUrl =
      "https://www.sicau.edu.cn:00443/info/123.htm?x=1#notice";
    assert.equal(resolvePublicSourceUrl(officialUrl)?.url, officialUrl);
    for (const url of [
      "http://www.sicau.edu.cn/a",
      "https://www.sicau.edu.cn:8443/a",
      "https://www.sicau.edu.cn@192.168.0.1/a",
      "https://192.168.0.1/a",
      "https://printer.local/a",
      "https://www.sicau.edu.cn%2e/a",
      "javascript:alert(1)",
    ]) {
      assert.equal(resolvePublicSourceUrl(url), null, url);
    }
  } finally {
    globalThis.URL = originalUrl;
  }
});

test("切换 Notice 后迟到的复制结果不写回旧条目", async () => {
  const pendingResolvers = [];
  const copied = [];
  const actions = createSourceActions({
    writeClipboard: (url) =>
      new Promise((resolve) => {
        pendingResolvers.push(() => {
          copied.push(url);
          resolve();
        });
      }),
  });
  const first = actions.copy("https://news.example.edu.cn/a");
  const second = actions.copy("https://news.example.edu.cn/b");
  // 组件侧以代次丢弃迟到结果；这里确认动作本身不缓存或复用上一个 Notice 的地址。
  pendingResolvers[0]();
  pendingResolvers[1]();
  assert.equal((await first).url, "https://news.example.edu.cn/a");
  assert.equal((await second).url, "https://news.example.edu.cn/b");
  assert.deepEqual(copied, [
    "https://news.example.edu.cn/a",
    "https://news.example.edu.cn/b",
  ]);
});
