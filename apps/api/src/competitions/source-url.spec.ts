import { manualNoticeUrlError } from "./source-url.js";

describe("手工维护通道的外链校验", () => {
  it.each([
    "https://sicau.edu.cn/info/1.htm",
    "https://www.moe.gov.cn/s78/A08/tongzhi/2026/1.html",
    "https://cxcy.moe.gov.cn/contest/2026?from=list#detail",
    "https://example.org:443/path",
    "HTTPS://Example.ORG/path",
    // 凭据位于 authority 段，路径与查询串里的 @ 不影响主机判定。
    "https://www.moe.gov.cn/notice/@2026/index.html",
    "https://www.moe.gov.cn/a?mail=a@b.cn",
  ])("接受公开 HTTPS 地址 %s", (url) => {
    expect(manualNoticeUrlError(url)).toBeNull();
  });

  it.each([
    ["HTTP 明文", "http://sicau.edu.cn/info/1.htm"],
    ["javascript 伪协议", "javascript:alert(1)"],
    ["data 伪协议", "data:text/html,<script>alert(1)</script>"],
    ["协议相对地址", "//sicau.edu.cn/a"],
    ["无协议", "sicau.edu.cn/a"],
    ["带账号", "https://user@example.org/a"],
    ["带账号密码", "https://user:pass@example.org/a"],
    ["账号带路径混淆", "https://example.org@evil.org/a"],
    ["IPv4 字面量", "https://127.0.0.1/a"],
    ["公网 IPv4 仍是字面量", "https://202.115.1.1/a"],
    ["IPv6 字面量", "https://[::1]/a"],
    ["十进制 IPv4", "https://2130706433/a"],
    ["十六进制 IPv4", "https://0x7f.1/a"],
    ["localhost", "https://localhost/a"],
    ["单标签主机", "https://intranet/a"],
    ["内网后缀", "https://wiki.internal/a"],
    ["mDNS 后缀", "https://printer.local/a"],
    ["home.arpa", "https://router.home.arpa/a"],
    ["保留 TLD", "https://host.invalid/a"],
    ["文档保留 TLD", "https://host.example/a"],
    ["测试保留 TLD", "https://host.test/a"],
    ["非默认端口", "https://example.org:8443/a"],
    ["反斜杠混淆", "https://example.org\\@evil.org/a"],
    ["空白字符", "https://example.org /a"],
    ["下划线主机", "https://bad_host.example.org/a"],
    ["标签首尾连字符", "https://-bad.example.org/a"],
    ["数字顶级域", "https://host.123/a"],
    ["超长", "https://example.org/" + "a".repeat(2001)],
    ["空值", ""],
  ])("拒绝%s", (_label, url) => {
    expect(manualNoticeUrlError(url)).toBeTruthy();
  });
});
