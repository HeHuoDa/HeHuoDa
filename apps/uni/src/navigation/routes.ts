/*
 * 用户端导航注册表：uni-app 页面、旧 Web 路由与页面标题的唯一来源。
 *
 * 新增业务页面时只需两步：在 pages.json 注册页面，再在这里补一条定义；
 * 页面跳转统一走 navigation/navigate.ts，不再另建一套路由状态。
 * 契约测试（scripts/navigation-contract.test.mjs）会校验三处保持一致。
 */

import {
  copyRouteQuery,
  parseProfileSection,
  type ProfileSection,
  type RouteQuery,
} from "./params.ts";

export type TabRouteName = "home" | "teams" | "profile";
export type PageRouteName =
  | "competition-detail"
  | "team-detail"
  | "team-new"
  | "favorites"
  | "notifications"
  | "login"
  | "register"
  | "not-found"
  | "style"
  | "health";
export type RouteName = TabRouteName | PageRouteName;

export interface RouteDefinition {
  name: RouteName;
  /** pages.json 中的绝对路径，也是 navigateTo / switchTab 的 url */
  path: `/${string}`;
  /** 与 pages.json 的 navigationBarTitleText 一致，不使用 document.title */
  title: string;
  kind: "tab" | "page";
  /** placeholder 表示预留页，需在页面上标注开发状态 */
  status: "placeholder" | "baseline";
  /** 对应旧 Web 路由；工程基线页没有旧地址 */
  source: string | null;
  description: string;
}

export const routeRegistry = {
  home: {
    name: "home",
    path: "/pages/index/index",
    title: "首页",
    kind: "tab",
    status: "baseline",
    source: "/home",
    description: "在这里发现校园比赛与项目，找到一起成长的伙伴。",
  },
  teams: {
    name: "teams",
    path: "/pages/teams/index",
    title: "找队友",
    kind: "tab",
    status: "baseline",
    source: "/teams",
    description: "按项目与角色发现招募，寻找志同道合的伙伴。",
  },
  profile: {
    name: "profile",
    path: "/pages/profile/index",
    title: "个人中心",
    kind: "tab",
    status: "placeholder",
    source: "/profile",
    description: "查看示例资料、编辑个人介绍与技能，了解联系方式授权。",
  },
  "competition-detail": {
    name: "competition-detail",
    path: "/pages/home/competition",
    title: "比赛详情",
    kind: "page",
    status: "baseline",
    source: "/home/competitions/:id",
    description: "查看比赛届次、赛道、赛段和来源通知，进入关联演示招募。",
  },
  "team-detail": {
    name: "team-detail",
    path: "/pages/teams/detail",
    title: "队伍详情",
    kind: "page",
    status: "baseline",
    source: "/teams/:id",
    description: "了解队伍目标、成员与合作需求。",
  },
  "team-new": {
    name: "team-new",
    path: "/pages/teams/new",
    title: "发布招募",
    kind: "page",
    status: "baseline",
    source: "/teams/new",
    description: "填写项目目标与角色需求，演示发布队伍招募。",
  },
  favorites: {
    name: "favorites",
    path: "/pages/my/favorites",
    title: "我的收藏",
    kind: "page",
    status: "placeholder",
    source: "/my/favorites",
    description: "在这里回看关注的比赛。",
  },
  notifications: {
    name: "notifications",
    path: "/pages/notifications/index",
    title: "站内通知",
    kind: "page",
    status: "placeholder",
    source: "/notifications",
    description: "组队进展与平台提醒将在这里展示。",
  },
  login: {
    name: "login",
    path: "/pages/auth/login",
    title: "登录",
    kind: "page",
    status: "baseline",
    source: "/login",
    description: "登录禾伙搭，继续寻找校园伙伴。",
  },
  register: {
    name: "register",
    path: "/pages/auth/register",
    title: "注册",
    kind: "page",
    status: "baseline",
    source: "/register",
    description: "注册禾伙搭，从认识彼此开始。",
  },
  "not-found": {
    name: "not-found",
    path: "/pages/not-found/index",
    title: "页面不存在",
    kind: "page",
    status: "placeholder",
    source: "*",
    description: "这个地址没有对应的页面，回到首页继续看看吧。",
  },
  health: {
    name: "health",
    path: "/pages/health/index",
    title: "服务状态",
    kind: "page",
    status: "baseline",
    source: "/health",
    description: "检查服务进程连接状态。",
  },
  style: {
    name: "style",
    path: "/pages/style/index",
    title: "样式基线",
    kind: "page",
    status: "baseline",
    source: null,
    description: "主题色、字号与控件状态的样式回归页。",
  },
} satisfies Record<RouteName, RouteDefinition>;

/** 平台主导航（tabBar）的顺序与文案，pages.json 的 tabBar 必须与之一致。 */
export const tabRoutes = [
  { name: "home", text: "首页" },
  { name: "teams", text: "找队友" },
  { name: "profile", text: "我的" },
] as const satisfies readonly { name: TabRouteName; text: string }[];

export function routePath(name: RouteName): string {
  return routeRegistry[name].path;
}

export function routeTitle(name: RouteName): string {
  return routeRegistry[name].title;
}

/**
 * 旧 Web 路由 → 新客户端的完整映射清单。
 * 目标为 null 表示不迁移为页面，必须写明原因。
 */
export interface SourceRoute {
  source: string;
  target: RouteName | null;
  /** 固定分区：旧地址本身带语义，不依赖 query */
  section?: ProfileSection;
  note?: string;
}

export const sourceRoutes: readonly SourceRoute[] = [
  { source: "/", target: "home", note: "旧入口重定向到首页" },
  { source: "/home", target: "home", note: "筛选参数由首页任务在目标页解析" },
  {
    source: "/home/competitions/:id",
    target: "competition-detail",
    note: "id 为稳定业务 ID",
  },
  {
    source: "/teams",
    target: "teams",
    note: "筛选参数由找队友任务在目标页解析",
  },
  { source: "/teams/new", target: "team-new" },
  { source: "/teams/:id", target: "team-detail", note: "id 为稳定业务 ID" },
  {
    source: "/my/teams",
    target: "profile",
    section: "teams",
    note: "旧地址固定映射到个人中心的队伍分区",
  },
  {
    source: "/my/applications",
    target: "profile",
    section: "applications",
    note: "旧地址固定映射到个人中心的申请分区",
  },
  { source: "/my/favorites", target: "favorites" },
  { source: "/notifications", target: "notifications" },
  {
    source: "/profile",
    target: "profile",
    note: "section 只接受 teams / applications，其余取值回落到资料区",
  },
  { source: "/login", target: "login" },
  { source: "/register", target: "register" },
  {
    source: "/health",
    target: "health",
    note: "独立健康页，通过统一请求入口检查服务进程。",
  },
  { source: "*", target: "not-found", note: "未知地址与非法入口的兜底页" },
];

export interface ResolvedSourceAddress {
  name: RouteName;
  params: Record<string, string>;
  /** 合法附加参数与动态路径参数分开保留；个人中心分区单独交接。 */
  query: RouteQuery;
  section?: ProfileSection;
}

function normalizeSource(source: string): string {
  const path = source.split(/[?#]/, 1)[0].trim();
  if (!path || path === "/") return "/";
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

function matchDynamic(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    const actual = pathParts[index];
    if (expected.startsWith(":")) {
      let value: string;
      try {
        value = decodeURIComponent(actual);
      } catch {
        return null;
      }
      if (!value) return null;
      params[expected.slice(1)] = value;
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

/**
 * 把旧 Web 地址解析为目标页面与参数，供应用内跳转与 H5 兼容层共用。
 * 未知地址返回 not-found，不抛错、不猜测目标。
 */
export function resolveSourceAddress(
  source: string,
  query: Record<string, unknown> = {},
): ResolvedSourceAddress {
  const path = normalizeSource(source);
  const exact = sourceRoutes.find(
    (route) => route.target && route.source === path,
  );
  let matched: SourceRoute | undefined = exact;
  let params: Record<string, string> | null = exact ? {} : null;
  if (!matched) {
    for (const route of sourceRoutes) {
      if (!route.target || !route.source.includes(":")) continue;
      const candidate = matchDynamic(route.source, path);
      if (candidate) {
        matched = route;
        params = candidate;
        break;
      }
    }
  }
  if (!matched?.target || !params) {
    return { name: "not-found", params: {}, query: {} };
  }

  const resolved: ResolvedSourceAddress = {
    name: matched.target,
    params,
    query: copyRouteQuery(query),
  };
  if (matched.target === "profile") {
    resolved.section = matched.section
      ? matched.section
      : parseProfileSection(query.section).section;
    delete resolved.query.section;
  }
  return resolved;
}
