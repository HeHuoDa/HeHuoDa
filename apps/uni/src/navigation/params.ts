/*
 * 路由参数解析：页面只通过这里读取参数，不直接相信 onLoad 的原始对象。
 *
 * 规则（对应 Issue #60 验收项）：
 * - 缺失或空白：missing，页面显示“参数缺失”，不猜测内容。
 * - 重复键取值一致：接受该值；重复且冲突：conflict，判为无效。
 * - 业务 ID 只允许字母、数字与连字符，首字符不能是连字符，最长 64。
 * - 参数只用于定位展示内容，不代表身份、权限或登录态。
 */

export type ProfileSection = "profile" | "teams" | "applications";
export type RouteQuery = Record<string, string | string[]>;
export type ParamIssue = "missing" | "invalid" | "conflict";

/** 只接收平台 query 的字符串/字符串数组，复制数组，避免交接后被调用方改写。 */
export function copyRouteQuery(query: Record<string, unknown>): RouteQuery {
  return Object.fromEntries(
    Object.entries(query).flatMap(
      ([key, value]): [string, string | string[]][] => {
        if (typeof value === "string") return [[key, value]];
        if (
          Array.isArray(value) &&
          value.every((item) => typeof item === "string")
        ) {
          return [[key, [...value]]];
        }
        return [];
      },
    ),
  );
}

export type ParamResult =
  { value: string; issue?: undefined } | { value: ""; issue: ParamIssue };

const BUSINESS_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

function missing(): ParamResult {
  return { value: "", issue: "missing" };
}

/**
 * 读取单值参数。
 *
 * 页面参数只允许单值，因此这里统一处理三种来源：
 * - string：正常取值；含逗号时按重复键拆分（见下）。
 * - string[]：直接调用或测试时的重复键形态。
 * - 其他类型：invalid。
 *
 * uni-app H5 会把 `?id=a&id=b` 合并成 `"a,b"` 再交给 onLoad，
 * 因此逗号按“重复键分隔符”处理：取值一致则接受，不一致判为冲突。
 * 业务 ID 与分区本身都不允许逗号，这个拆分不会误伤合法取值。
 */
export function parseSingleParam(raw: unknown): ParamResult {
  const values = toValues(raw);
  if (typeof values === "string") return { value: "", issue: values };
  if (values.length === 0) return missing();
  if (new Set(values).size > 1) return { value: "", issue: "conflict" };
  return { value: values[0] };
}

/** 把原始参数归一为候选值列表；返回字符串表示整体性的参数问题。 */
function toValues(raw: unknown): string[] | ParamIssue {
  if (raw === undefined || raw === null) return "missing";
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }
  if (typeof raw !== "string") return "invalid";
  const value = raw.trim();
  if (!value) return "missing";
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 稳定业务 ID：详情页只接受这一类取值。 */
export function parseBusinessId(raw: unknown): ParamResult {
  const parsed = parseSingleParam(raw);
  if (parsed.issue) return parsed;
  return BUSINESS_ID.test(parsed.value)
    ? { value: parsed.value }
    : { value: "", issue: "invalid" };
}

/**
 * 个人中心分区。缺省为资料区；出现但取值非法时回落到资料区并返回问题，
 * 由页面显示明确提示，而不是静默忽略。
 */
export function parseProfileSection(raw: unknown): {
  section: ProfileSection;
  issue?: ParamIssue;
} {
  if (raw === undefined || raw === null) return { section: "profile" };
  const parsed = parseSingleParam(raw);
  if (parsed.issue) {
    return {
      section: "profile",
      issue: parsed.issue === "conflict" ? "conflict" : "invalid",
    };
  }
  if (parsed.value === "teams" || parsed.value === "applications") {
    return { section: parsed.value };
  }
  return { section: "profile", issue: "invalid" };
}

/** 面向用户的参数提示，页面不各自拼文案。 */
export function paramMessage(issue: ParamIssue, label: string): string {
  if (issue === "missing") return `缺少${label}参数，无法确定要查看的内容。`;
  if (issue === "conflict") {
    return `${label}参数重复且取值不一致，请从列表重新进入。`;
  }
  return `${label}参数无效，请从列表重新进入。`;
}
