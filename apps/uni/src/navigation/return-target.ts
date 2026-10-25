import { routeRegistry, type PageRouteName } from "./routes.ts";

/**
 * 登录后的返回目标。
 *
 * 只接受导航注册表里的平台内部页面，可写路由名（team-new）或注册路径
 * （/pages/teams/new）。外部 URL、协议头、双斜杠、tab 页与未知路径一律拒绝，
 * 页面据此回退到“返回上一页”，不跟随任意地址。
 * 返回只恢复位置，不自动重发招募、入队或申请等原操作。
 */
export function resolveReturnTarget(raw: unknown): PageRouteName | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 128) return null;
  // 拒绝协议头（https:、weixin: 等）与协议相对地址。
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return null;
  const path = value.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  const entries = Object.values(routeRegistry);
  const byName = entries.find(
    (route) => route.kind === "page" && route.name === path,
  );
  if (byName)
    return isReturnable(byName.name) ? (byName.name as PageRouteName) : null;
  const byPath = entries.find(
    (route) => route.kind === "page" && route.path === `/${path}`,
  );
  return byPath && isReturnable(byPath.name)
    ? (byPath.name as PageRouteName)
    : null;
}

/** 认证页与兜底页不作为返回目标，避免登录后回到登录页或 404。 */
const NOT_RETURNABLE = new Set(["login", "register", "not-found"]);

function isReturnable(name: string): boolean {
  return !NOT_RETURNABLE.has(name);
}
