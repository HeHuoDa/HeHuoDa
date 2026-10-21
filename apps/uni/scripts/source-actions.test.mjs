import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSourceUrl, resolveWebViewSource } from "../src/source/policy.ts";
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
