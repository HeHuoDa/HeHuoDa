import { describe, expect, it } from "vitest";
import { manualSourceUrlError } from "./source-url";
import { safeSourceUrl } from "./review";

// 手工比赛通道：ADR 0011 规定的公开 HTTPS 外链规则。采集审核通道的
// safeSourceUrl 边界必须保持原样，两条通道的判定不能互相放宽。
describe("手工比赛外链校验与采集通道隔离", () => {
  it.each([
    "https://www.moe.gov.cn/s78/A08/tongzhi/2026/1.html",
    // 显式 :443 由 URL 归一化为默认端口，故允许。
    "https://www.moe.gov.cn:443/a",
    "https://www.moe.gov.cn/notice/@2026/index.html",
  ])("允许公开 HTTPS 外链 %s", (url) => {
    expect(manualSourceUrlError(url)).toBeNull();
  });

  it.each([
    ["HTTP 明文", "http://www.moe.gov.cn/a"],
    ["账号信息", "https://user@www.moe.gov.cn/a"],
    ["密码", "https://user:pass@www.moe.gov.cn/a"],
    ["非默认端口", "https://www.moe.gov.cn:8443/a"],
    ["IPv4 字面量", "https://202.115.1.1/a"],
    ["IPv6 字面量", "https://[2001:db8::1]/a"],
    ["localhost", "https://localhost/a"],
    ["单标签内网名", "https://intranet/a"],
    ["保留后缀", "https://foo.internal/a"],
    ["私有网段", "https://192.168.1.10/a"],
    ["空白字符", "https://www.moe.gov.cn/a b"],
    ["反斜杠", "https://www.moe.gov.cn\\a"],
    ["HTML 标记", "https://www.moe.gov.cn/<script>"],
  ])("拒绝%s", (_label, url) => {
    expect(manualSourceUrlError(url)).not.toBeNull();
  });

  it("采集审核通道保持原有边界，不因手工规则放宽或收紧", () => {
    // safeSourceUrl 只判断协议与凭据，仍接受 http 与显式端口。
    expect(safeSourceUrl("http://xxgc.sicau.edu.cn/a")).toBe(
      "http://xxgc.sicau.edu.cn/a",
    );
    expect(safeSourceUrl("https://xxgc.sicau.edu.cn:8443/a")).toBe(
      "https://xxgc.sicau.edu.cn:8443/a",
    );
    // 手工通道对同一地址的判定不同，二者互不影响。
    expect(manualSourceUrlError("http://xxgc.sicau.edu.cn/a")).not.toBeNull();
    expect(
      manualSourceUrlError("https://xxgc.sicau.edu.cn:8443/a"),
    ).not.toBeNull();
  });
});
