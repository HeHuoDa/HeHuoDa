import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSourceUrl,
  resolvePublicSourceUrl,
  resolveWebViewSource,
} from "../src/source/policy.ts";
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

test("承载页重新校验精确业务主机，默认关闭，跳转参数和协议不能绕过", () => {
  const url = "https://news.example.edu.cn/info/2026.htm";
  assert.equal(resolveWebViewSource(url), null);
  assert.equal(resolveWebViewSource(url, ["news.example.edu.cn"]), url);
  for (const candidate of [
    "http://news.example.edu.cn/a",
    "https://news.example.edu.cn:8443/a",
    "https://news.example.edu.cn.evil.test/a",
    "https://evilnews.example.edu.cn/a",
    "https://user@news.example.edu.cn/a",
    "https://news.example.edu.cn/a?redirect=https://evil.test",
    "https://news.example.edu.cn/a?%75rl=%2f%2fevil.test",
    "https://news.example.edu.cn/a#https://evil.test",
    [url, "https://evil.test"],
  ]) {
    assert.equal(
      resolveWebViewSource(candidate, ["news.example.edu.cn"]),
      null,
      String(candidate),
    );
  }
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
    [],
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

test("微信空/未允许域名直接复制；核准域名打开，失效或导航失败回退复制", async () => {
  const url = "https://news.example.edu.cn/info/2026.htm";
  const calls = [];
  const ports = {
    writeClipboard: async (value) => {
      calls.push(["copy", value]);
    },
    openWebView: async (value) => {
      calls.push(["open", value]);
    },
  };
  assert.equal(
    (await createSourceActions(ports).openWeixin(url)).status,
    "copied",
  );
  assert.deepEqual(calls, [["copy", url]]);
  calls.length = 0;
  assert.equal(
    (await createSourceActions(ports, ["news.example.edu.cn"]).openWeixin(url))
      .status,
    "opened",
  );
  assert.deepEqual(calls, [["open", url]]);
  calls.length = 0;
  const failed = createSourceActions(
    {
      ...ports,
      openWebView: async () => {
        throw new Error("domain expired");
      },
    },
    ["news.example.edu.cn"],
  );
  assert.equal((await failed.openWeixin(url)).status, "copied");
  assert.deepEqual(calls, [["copy", url]]);
  calls.length = 0;
  assert.equal(
    (await failed.openWeixin("data:text/html,evil")).status,
    "invalid",
  );
  assert.deepEqual(calls, []);
});

test("旧 Notice 的迟到导航失败不能触发复制，新动作不受影响", async () => {
  let reject,
    current = true;
  const copied = [];
  const actions = createSourceActions(
    {
      writeClipboard: async (url) => {
        copied.push(url);
      },
      openWebView: () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    },
    ["news.example.edu.cn"],
  );
  const old = actions.openWeixin(
    "https://news.example.edu.cn/a",
    () => current,
  );
  current = false;
  reject(new Error("navigation failed"));
  assert.equal((await old).status, "cancelled");
  assert.deepEqual(copied, []);
  await actions.copy("https://news.example.edu.cn/b");
  assert.deepEqual(copied, ["https://news.example.edu.cn/b"]);
});
