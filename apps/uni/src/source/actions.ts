import { parseSourceUrl } from "./policy.ts";

export interface SourceResult {
  status: "copied" | "manual" | "invalid";
  message: string;
  url: string;
}

export interface SourcePorts {
  writeClipboard?: (url: string) => Promise<void>;
}

/**
 * 来源动作只保留复制。
 *
 * H5 由 `SourceLink.h5.vue` 承担真实 `<a>` 新窗口打开（公开 HTTPS 规则），
 * 复制是打开不可用或失败时的可执行回退；Android 的系统浏览器打开归 #226 实测。
 * 旧小程序内嵌 web-view 承载已按 ADR 0011 退役，不再保留对应的导航端口。
 *
 * `accept` 是可操作地址的接受规则：H5 传公开 HTTPS 规则，默认沿用保守解析。
 */
export function createSourceActions(
  ports: SourcePorts,
  accept: (value: unknown) => unknown = parseSourceUrl,
) {
  async function copy(value: unknown): Promise<SourceResult> {
    const source = accept(value) as ReturnType<typeof parseSourceUrl>;
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
  return { copy };
}
