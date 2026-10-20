import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...(["users", "recruitments", "reports"] as const).flatMap((kind) => [
      {
        path: `/${kind}`,
        component: () => import("./views/GovernanceView.vue"),
        meta: {
          title: {
            users: "用户查询",
            recruitments: "招募治理",
            reports: "举报处理",
          }[kind],
          governance: kind,
        },
      },
      {
        path: `/${kind}/:id`,
        component: () => import("./views/GovernanceView.vue"),
        meta: {
          title: {
            users: "用户详情",
            recruitments: "招募详情",
            reports: "举报详情",
          }[kind],
          governance: kind,
        },
      },
    ]),
    { path: "/teams", redirect: "/recruitments" },
    {
      path: "/",
      component: () => import("./views/OverviewView.vue"),
      meta: { title: "工作台" },
    },
    {
      path: "/competitions",
      component: () => import("./views/PendingView.vue"),
      meta: { title: "比赛管理" },
    },
    {
      path: "/reviews",
      component: () => import("./views/PendingView.vue"),
      meta: { title: "通知审核" },
    },
    {
      path: "/sources",
      component: () => import("./views/PendingView.vue"),
      meta: { title: "采集来源" },
    },
    {
      path: "/operations",
      component: () => import("./views/OperationsView.vue"),
      meta: { title: "操作记录" },
    },
    {
      path: "/login",
      component: () => import("./views/LoginView.vue"),
      meta: { title: "管理员登录" },
    },
    ...[
      ["/runs", "采集运行"],
      ["/notifications", "通知管理"],
    ].map(([path, title]) => ({
      path: path!,
      component: () => import("./views/PendingView.vue"),
      meta: { title },
    })),
    {
      path: "/:pathMatch(.*)*",
      component: () => import("./views/NotFoundView.vue"),
      meta: { title: "页面不存在" },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
router.afterEach((to) => {
  document.title = String(to.meta.title) + " · 禾伙搭管理端";
});
