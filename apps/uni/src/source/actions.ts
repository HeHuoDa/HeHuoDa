import {
  approvedWebViewHosts,
  parseSourceUrl,
  resolveWebViewSource,
} from "./policy.ts";

export interface SourceResult {
  status: "copied" | "manual" | "invalid" | "opened" | "cancelled";
  message: string;
  url: string;
}

export interface SourcePorts {
  writeClipboard?: (url: string) => Promise<void>;
  openWebView?: (url: string) => Promise<void>;
}

export function createSourceActions(
  ports: SourcePorts,
  allowedHosts: readonly string[] = approvedWebViewHosts,
) {
  async function copy(value: unknown): Promise<SourceResult> {
    const source = parseSourceUrl(value);
    if (!source)
      return {
        status: "invalid",
        message: "来源地址无效，无法打开或复制。",
        url: "",
      };
    try {
      if (!ports.writeClipboard) throw new Error("clipboard unavailable");
      await ports.writeClipboard(source.url);
      return {
        status: "copied",
        message: "官方链接已复制，请在浏览器中粘贴核对原文。",
        url: source.url,
      };
    } catch {
      return {
        status: "manual",
        message:
          "未能复制（可能未获隐私授权或浏览器不支持），请长按或选中下方原地址手动复制，再到浏览器打开。",
        url: source.url,
      };
    }
  }
  async function openWeixin(
    value: unknown,
    isCurrent = () => true,
  ): Promise<SourceResult> {
    const source = parseSourceUrl(value);
    if (!source) return copy(value);
    const target = resolveWebViewSource(source.url, allowedHosts);
    if (target && ports.openWebView) {
      try {
        await ports.openWebView(target);
        return {
          status: "opened",
          message: "已打开官方原文。",
          url: source.url,
        };
      } catch {
        // 导航或业务域名不可用时仍提供可执行的复制路径。
      }
    }
    if (!isCurrent()) return { status: "cancelled", message: "", url: "" };
    const result = await copy(source.url);
    return {
      ...result,
      message: `当前无法在小程序内打开此原文。${result.message}`,
    };
  }
  return { copy, openWeixin };
}
