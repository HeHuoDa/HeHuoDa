import {
  createRouter,
  createWebHistory,
  type RouterHistory,
  type RouteRecordRaw,
  stringifyQuery,
} from "vue-router";

import { canonicalQuery } from "../data/competition-discovery";
import { canonicalTeamQuery } from "../data/team-demo";

export type NavigationSection =
  | "home"
  | "teams"
  | "my-teams"
  | "applications"
  | "favorites"
  | "notifications"
  | "profile";

declare module "vue-router" {
  interface RouteMeta {
    title: string;
    description?: string;
    navigation?: NavigationSection;
  }
}

const placeholder = () => import("../views/PlaceholderView.vue");
export const routes: RouteRecordRaw[] = [
  { path: "/", name: "entry", redirect: "/home" },
  {
    path: "/",
    component: () => import("../layouts/StudentLayout.vue"),
    children: [
      {
        path: "home",
        component: () => import("../views/HomeView.vue"),
        meta: { title: "首页", navigation: "home" },
        children: [
          {
            path: "",
            name: "home",
            component: () => import("../views/CompetitionListView.vue"),
            meta: {
              title: "首页",
              description: "在这里发现校园比赛与项目，找到一起成长的伙伴。",
            },
          },
          {
            path: "competitions/:id",
            name: "competition-detail",
            component: () => import("../views/CompetitionDetailView.vue"),
            meta: {
              title: "比赛详情",
              description: "比赛规则、赛道与关联招募将在这里展示。",
            },
          },
        ],
      },
      {
        path: "teams",
        name: "teams",
        component: () => import("../views/TeamListView.vue"),
        meta: {
          title: "找队友",
          navigation: "teams",
          description: "按项目与角色发现招募，寻找志同道合的伙伴。",
        },
      },
      {
        path: "teams/new",
        name: "team-new",
        component: () => import("../views/TeamNewView.vue"),
        meta: {
          title: "发布招募",
          navigation: "teams",
          description: "填写项目目标与角色需求，演示发布队伍招募。",
        },
      },
      {
        path: "teams/:id",
        name: "team-detail",
        component: () => import("../views/TeamDetailView.vue"),
        meta: {
          title: "队伍详情",
          navigation: "teams",
          description: "了解队伍目标、成员与合作需求。",
        },
      },
      {
        path: "my/teams",
        name: "my-teams",
        redirect: (to) => ({
          path: "/profile",
          query: { ...to.query, section: "teams" },
          hash: to.hash,
        }),
        meta: {
          title: "我的队伍",
          navigation: "my-teams",
          description: "在这里查看自己加入与带领的队伍。",
        },
      },
      {
        path: "my/applications",
        name: "applications",
        redirect: (to) => ({
          path: "/profile",
          query: { ...to.query, section: "applications" },
          hash: to.hash,
        }),
        meta: {
          title: "申请与邀请",
          navigation: "applications",
          description: "在这里查看入队申请与邀请，跟进组队进展。",
        },
      },
      {
        path: "my/favorites",
        name: "favorites",
        component: placeholder,
        meta: {
          title: "我的收藏",
          navigation: "favorites",
          description: "在这里回看关注的比赛。",
        },
      },
      {
        path: "notifications",
        name: "notifications",
        component: placeholder,
        meta: {
          title: "站内通知",
          navigation: "notifications",
          description: "组队进展与平台提醒将在这里展示。",
        },
      },
      {
        path: "profile",
        name: "profile",
        component: () => import("../views/ProfileView.vue"),
        meta: {
          title: "个人中心",
          navigation: "profile",
          description: "查看示例资料、编辑个人介绍与技能，了解联系方式授权。",
        },
      },
    ],
  },
  {
    path: "/",
    component: () => import("../layouts/BrandLayout.vue"),
    children: [
      {
        path: "login",
        name: "login",
        component: () => import("../views/AuthView.vue"),
        props: { mode: "login" },
        meta: {
          title: "登录",
        },
      },
      {
        path: "register",
        name: "register",
        component: () => import("../views/AuthView.vue"),
        props: { mode: "register" },
        meta: {
          title: "注册",
        },
      },
      {
        path: ":pathMatch(.*)*",
        name: "not-found",
        component: () => import("../views/NotFoundView.vue"),
        meta: { title: "页面不存在" },
      },
    ],
  },
  {
    path: "/health",
    name: "health",
    component: () => import("../views/HealthView.vue"),
    meta: { title: "服务状态" },
  },
];

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  const instance = createRouter({
    history,
    routes,
    scrollBehavior: (to, _from, saved) => {
      if (saved) return saved;
      const element = to.hash
        ? document.getElementById(to.hash.slice(1))
        : null;
      return element ? { el: element, top: 24 } : { top: 0 };
    },
  });
  instance.beforeEach((to) => {
    if (to.name === "profile") {
      const section = to.query.section;
      if (
        section !== undefined &&
        section !== "teams" &&
        section !== "applications"
      ) {
        const query = { ...to.query };
        delete query.section;
        return { path: to.path, query, hash: to.hash, replace: true };
      }
      return;
    }
    if (to.meta.navigation === "teams") {
      const query = canonicalTeamQuery(to.query);
      if (stringifyQuery(query) !== stringifyQuery(to.query))
        return { path: to.path, query, replace: true };
      return;
    }
    if (to.name !== "home" && to.name !== "competition-detail") return;
    const query = canonicalQuery(to.query);
    if (stringifyQuery(query) !== stringifyQuery(to.query))
      return { path: to.path, query, hash: to.hash, replace: true };
  });
  instance.afterEach((to) => {
    document.title = `${to.meta.title} · 禾伙人`;
  });
  return instance;
}

export const router = createAppRouter();
