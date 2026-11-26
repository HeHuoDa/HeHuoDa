import { resolveApiConfig } from "../src/api/config.ts";

/** Android 包名占位值：仅用于本地资源编译，不是已选定的正式 ID。 */
export const ANDROID_PLACEHOLDER_PACKAGENAME = "com.example.hehuoda";

/** HTTPS 默认端口；WHATWG URL 解析时会把 `:443` 归一为无端口。 */
const DEFAULT_HTTPS_PORT = "443";

/** 错误信息只说变量和约束，不回显原值，避免把凭据写进构建日志。 */
function appUrlProblem(constraint) {
  throw new Error(`VITE_API_BASE_URL 不符合 Android 构建要求：${constraint}。`);
}

/** 超时与地址同属编译期预检：调用运行期纯函数校验范围，错误只报变量名与约束。 */
const TIMEOUT_PROBE_URL = "https://api.example.test/api/v1";
/** 接受字符串或已解析的毫秒数；非字符串值按十进制字符串交给运行时纯函数复核。 */
export function parseAppTimeout(value) {
  try {
    return resolveApiConfig({
      baseUrl: TIMEOUT_PROBE_URL,
      timeout: typeof value === "number" ? String(value) : value,
      development: false,
      platform: "app",
    }).timeout;
  } catch {
    throw new Error("VITE_API_TIMEOUT_MS 须为 1–60000 的整数（毫秒）。");
  }
}

/**
 * Android 基址判定分两层：
 * 1. 词法层按**原始输入**判定，先挡掉 `https:///host`、反斜线、`..`、前导零端口等会被解析器
 *    静默「纠正」的写法，这类输入无法确认真实意图，直接拒绝。
 * 2. 结构化层用 Node `new URL()` 取协议、凭据、主机、端口、路径与查询字段，并回验解析结果与
 *    原始输入一致——解析器一旦改写同样拒绝；仅两处已知归一例外：主机名小写化，以及默认端口
 *    `443` 被剥成空端口（此时基址统一不带端口，非默认端口原样保留）。
 * 返回值与 `resolveApiConfig` 归一化后的运行期地址、超时一致，编译期与运行期共用同一份判定。
 */
export function parseAppApiBaseUrl(value, { development, timeout } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    appUrlProblem("必须显式配置完整 HTTPS 地址");
  }
  if (value !== value.trim()) appUrlProblem("不接受首尾空白");
  if (!/^https:\/\//i.test(value)) appUrlProblem("必须以 https:// 开头");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(value)) appUrlProblem("不接受控制字符");
  if (/[\s\\]/u.test(value)) appUrlProblem("不接受空白或反斜杠");
  if (value.includes("@")) appUrlProblem("不接受凭据");
  if (value.includes("?")) appUrlProblem("不接受查询字符串");
  if (value.includes("#")) appUrlProblem("不接受片段");
  const rest = value.slice("https://".length);
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const rawPath = slash === -1 ? "" : rest.slice(slash);
  // 解析器会把 `https:///host` 这类输入"纠正"成合法地址；这里直接当缺失主机拒绝。
  if (authority === "") appUrlProblem("主机须为多级 DNS 名称，不接受空主机");
  const match = /^([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(authority);
  if (!match) appUrlProblem("主机只能是 ASCII DNS 名称加可选端口");
  const [, rawHost, rawPort = ""] = match;
  if (rawPort) {
    if (rawPort.length > 1 && rawPort[0] === "0")
      appUrlProblem("端口不接受前导零");
    if (Number(rawPort) < 1 || Number(rawPort) > 65535) {
      appUrlProblem("端口须在 1–65535");
    }
  }
  if (rawPath && !/^\/[A-Za-z0-9._~/-]*$/.test(rawPath)) {
    appUrlProblem("路径只接受 /、字母、数字与 . _ ~ -");
  }
  if (rawPath.includes("//") || rawPath.split("/").includes("..")) {
    appUrlProblem("路径不接受重复斜杠或上级目录");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    appUrlProblem("必须是可解析的完整 HTTPS 地址");
  }
  // 词法层已挡住凭据、查询与片段；这里用结构化字段复核，防止解析器把它们挪到别处。
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    appUrlProblem("必须是无凭据、无查询与片段的 HTTPS 基址");
  }
  const hostname = rawHost.toLowerCase();
  // WHATWG URL 会剥掉默认端口 443，因此预期结构化端口按空串比较；其它端口差异仍视为改写。
  const expectedPort = rawPort === DEFAULT_HTTPS_PORT ? "" : rawPort;
  // 主机大小写归一是解析器的正常行为；其他任何差异都说明它纠正过原始输入。
  if (parsed.hostname !== hostname || parsed.port !== expectedPort) {
    appUrlProblem("主机与端口不接受解析器改写");
  }
  if ((rawPath || "/") !== parsed.pathname) {
    appUrlProblem("路径不接受解析器改写");
  }
  const labels = hostname.split(".");
  if (
    hostname.length > 253 ||
    labels.length < 2 ||
    !/^[a-z][a-z0-9-]*$/.test(labels.at(-1)) ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    // 同时排除 IP 字面量、单标签内网名与空标签（含 `https:///host`）。
    appUrlProblem("主机须为多级 DNS 名称，不接受 IP 字面量或单标签主机");
  }
  // 基址用解析后的 origin 拼接：默认端口统一省略，非默认合法端口原样保留。
  const normalized = `${parsed.origin}${rawPath.replace(/\/+$/, "")}`;
  const parsedTimeout = parseAppTimeout(timeout);
  let runtime;
  try {
    // 超时来自同一份合并 env，纯函数内部不读 process.env。
    runtime = resolveApiConfig({
      baseUrl: normalized,
      timeout: String(parsedTimeout),
      development: development === true,
      platform: "app",
    });
  } catch (error) {
    // 运行期纯函数只输出变量名，这里不再附带原值。
    appUrlProblem(`运行期配置校验未通过（${error.message}）`);
  }
  if (runtime.baseUrl !== normalized) {
    appUrlProblem("归一化结果与运行期解析不一致");
  }
  return { baseUrl: normalized, timeout: runtime.timeout };
}

/** 包名只做编译期格式与占位守卫；正式归属与命名仍属 #58/#219 后续验收。 */
export function validateAndroidPackageName(value, { release }) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim()
  ) {
    throw new Error(
      "UNI_ANDROID_PACKAGE_NAME 须为不含首尾空白的 Android 包名，如 com.<组织>.<应用>。",
    );
  }
  if (
    value.length > 255 ||
    !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value)
  ) {
    throw new Error(
      "UNI_ANDROID_PACKAGE_NAME 须为小写反向域名（每段以字母开头，可含数字和下划线，至少两段）。",
    );
  }
  if (release) {
    if (value.split(".").includes("example")) {
      throw new Error(
        "正式 Android 构建不接受示例包名，请注入受控的 UNI_ANDROID_PACKAGE_NAME。",
      );
    }
    if (
      /^(?:io\.dcloud|io\.uni|com\.dcloud|com\.android)(?:\.|$)/.test(value)
    ) {
      throw new Error(
        "正式 Android 构建不可使用 DCloud/Android 保留包名，请注入自有受控包名。",
      );
    }
  }
  return value;
}

export function platformConfig(env, target = "mp-weixin") {
  if (env.UNI_RELEASE && !["true", "false"].includes(env.UNI_RELEASE)) {
    throw new Error("UNI_RELEASE 只接受 true 或 false。");
  }
  const release = env.UNI_RELEASE === "true";
  if (target === "app") return appConfig(env, release);
  // H5 是现行主交付端，与已退役的微信 AppID 彻底解耦：不读取、不校验、不透传。
  if (target === "h5") return { appid: "", release };
  const appid = (env.UNI_MP_WEIXIN_APPID || "").trim();
  if (appid && !/^wx[0-9a-f]{16}$/i.test(appid)) {
    throw new Error(
      "UNI_MP_WEIXIN_APPID 须为 wx 开头的 18 位 AppID，不接受 touristappid。",
    );
  }
  if (release && !appid) {
    throw new Error("正式平台构建缺少 UNI_MP_WEIXIN_APPID；请先完成 #58。");
  }
  return { appid, release };
}

/** Android 目标不读取 UNI_MP_WEIXIN_APPID：发行配置与微信 AppID 互不依赖。 */
function appConfig(env, release) {
  // DEV 与 Release 都要求 HTTPS；mode 只影响 Vite 的 NODE_ENV 与运行期 DEV 标记。
  const { baseUrl: apiBaseUrl, timeout } = parseAppApiBaseUrl(
    env.VITE_API_BASE_URL,
    {
      development: env.NODE_ENV !== "production",
      // 先单独校验超时，使非法值报的是 VITE_API_TIMEOUT_MS 而不是地址。
      timeout: parseAppTimeout(env.VITE_API_TIMEOUT_MS),
    },
  );
  const packagename =
    env.UNI_ANDROID_PACKAGE_NAME === undefined ||
    env.UNI_ANDROID_PACKAGE_NAME === ""
      ? release
        ? validateAndroidPackageName("", { release })
        : ANDROID_PLACEHOLDER_PACKAGENAME
      : validateAndroidPackageName(env.UNI_ANDROID_PACKAGE_NAME, { release });
  return { appid: "", release, apiBaseUrl, timeout, packagename };
}

/**
 * 只写入本阶段需要的平台字段：Android 包名、微信 AppID。
 * H5 使用克隆后的模板，不写任何平台专属字段。
 * 不写签名、证书、密码或渠道字段；资源构建无法证明最终 APK 的权限与签名。
 */
export function applyPlatformManifest(manifest, target, config) {
  const next = structuredClone(manifest);
  if (target === "app") {
    const android = next["app-plus"]?.distribute?.android;
    if (!android)
      throw new Error(
        "manifest.template.json 缺少 app-plus.distribute.android。",
      );
    android.packagename = config.packagename;
    return next;
  }
  // 只有遗留小程序目标写 AppID；H5 模板副本原样返回。
  if (target !== "mp-weixin") return next;
  next["mp-weixin"].appid = config.appid;
  return next;
}
